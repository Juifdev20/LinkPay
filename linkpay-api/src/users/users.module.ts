import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuditModule } from '../audit/audit.module';
import { AccountDeletionService } from './account-deletion.service';
import { ProfilePhotosController } from './profile-photos.controller';
import { ProfilePhotosService } from './profile-photos.service';

@Module({
  imports: [SupabaseModule, AuditModule],
  controllers: [UsersController, ProfilePhotosController],
  providers: [UsersService, AccountDeletionService, ProfilePhotosService],
  exports: [UsersService],
})
export class UsersModule {}
