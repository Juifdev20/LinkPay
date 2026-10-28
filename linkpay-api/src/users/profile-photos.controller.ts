import { Controller, Delete, Param, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProfilePhotosService } from './profile-photos.service';
import { MAX_UPLOAD_BYTES } from './profile-photos.rules';

const FILE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };
// A person changes a photo now and then: generous for them, a wall for a script.
const LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Profile photos')
@ApiBearerAuth()
@Controller()
export class ProfilePhotosController {
  constructor(private photos: ProfilePhotosService) {}

  @Put('users/me/avatar')
  @Throttle(LIMIT)
  @ApiOperation({ summary: 'Set my profile photo (clients and merchants) — shrunk to a small WebP' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  setAvatar(@CurrentUser('id') userId: string, @CurrentUser('role') role: string, @UploadedFile() file?: Express.Multer.File) {
    return this.photos.setAvatar(userId, role, file?.buffer);
  }

  @Delete('users/me/avatar')
  @ApiOperation({ summary: 'Remove my profile photo' })
  removeAvatar(@CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return this.photos.removeAvatar(userId, role);
  }

  @Put('organizations/:id/logo')
  @Throttle(LIMIT)
  @ApiOperation({ summary: "Set the company logo (the company's owner or a gérant only)" })
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  setLogo(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.photos.setLogo(orgId, callerId, role, callerOrgId, file?.buffer);
  }

  @Delete('organizations/:id/logo')
  @ApiOperation({ summary: "Remove the company logo (the company's owner or a gérant only)" })
  removeLogo(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.photos.removeLogo(orgId, callerId, role, callerOrgId);
  }
}
