import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  async createOrganization(ownerId: string, email: string, data: {
    name: string;
    legal_name?: string;
    contact?: Record<string, any>;
  }) {
    const { data: org, error } = await this.supabaseService.getClient()
      .from('organizations')
      .insert({
        ...data,
        owner_id: ownerId,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create organization: ${error.message}`);
    }

    const { data: role } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'enterprise')
      .single();

    if (role) {
      // The JWT model only supports one "current" role per user — replace
      // any prior row(s) instead of accumulating (same reasoning as
      // merchants.service.ts createMerchant()).
      await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', ownerId);
      await this.supabaseService.getClient().from('user_roles').insert({
        user_id: ownerId,
        role_id: role.id,
        organization_id: org.id,
      });
    }

    const access_token = await this.authService.generateToken(ownerId, email, 'enterprise', undefined);

    return { organization: org, access_token };
  }

  async getOrganizationById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Organization not found');
    }

    return data;
  }

  async getOrganizationByOwner(ownerId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .select('*')
      .eq('owner_id', ownerId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No organization account found');
    }

    return data;
  }

  async updateOrganization(id: string, updates: Record<string, any>) {
    const allowedFields = ['name', 'legal_name', 'contact', 'status'];
    const filtered: Record<string, any> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update organization: ${error.message}`);
    }

    return data;
  }
}
