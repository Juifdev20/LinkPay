import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  public client: SupabaseClient;
  // Separate client dedicated to auth.signInWithPassword() calls. Calling
  // signInWithPassword() on a client mutates that client's *own* internal
  // session — even with persistSession:false — so every .from(...) query
  // made afterwards on that same instance runs as that user under RLS,
  // not as service_role. Keeping it on its own instance means the main
  // `client` (used for every other DB read/write in the app, expected to
  // always bypass RLS) never gets contaminated by whoever last logged in.
  public authClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!url || !serviceKey) {
      this.logger.warn('Supabase credentials not configured. Service will not function properly.');
      return;
    }

    this.client = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.authClient = createClient(url, anonKey || serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('Supabase client initialized');
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }
    return this.client;
  }

  /** Use only for auth.signInWithPassword() / other session-mutating calls — see class comment. */
  getAuthClient(): SupabaseClient {
    if (!this.authClient) {
      throw new Error('Supabase auth client not initialized');
    }
    return this.authClient;
  }
}
