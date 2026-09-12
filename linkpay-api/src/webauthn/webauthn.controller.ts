import { Controller, Post, Get, Delete, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// The registration/authentication response bodies are large, structurally
// nested shapes owned by the WebAuthn spec (via @simplewebauthn/browser on
// the frontend) — passed straight through to @simplewebauthn/server's
// verify*Response() functions, which do their own structural validation.
// Same pragmatic pass-through approach already used elsewhere in this
// codebase for third-party payload shapes (e.g. webhooks.controller.ts).

@ApiTags('WebAuthn')
@ApiBearerAuth()
@Controller('webauthn')
export class WebauthnController {
  constructor(private webauthnService: WebauthnService) {}

  @Post('register/options')
  @ApiOperation({ summary: 'Generate WebAuthn registration options (app-lock enrollment)' })
  registerOptions(@CurrentUser('id') userId: string, @CurrentUser('email') email: string) {
    return this.webauthnService.generateRegistrationOptionsFor(userId, email);
  }

  @Post('register/verify')
  @ApiOperation({ summary: 'Verify a WebAuthn registration response and store the credential' })
  registerVerify(
    @CurrentUser('id') userId: string,
    @Body() body: RegistrationResponseJSON,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.webauthnService.verifyRegistration(userId, body, userAgent);
  }

  @Post('auth/options')
  @ApiOperation({ summary: 'Generate WebAuthn authentication options (app-lock unlock)' })
  authOptions(@CurrentUser('id') userId: string) {
    return this.webauthnService.generateAuthenticationOptionsFor(userId);
  }

  @Post('auth/verify')
  @ApiOperation({ summary: 'Verify a WebAuthn authentication response (app-lock unlock)' })
  authVerify(@CurrentUser('id') userId: string, @Body() body: AuthenticationResponseJSON) {
    return this.webauthnService.verifyAuthentication(userId, body);
  }

  @Get('credentials')
  @ApiOperation({ summary: "List the current user's registered app-lock credentials" })
  list(@CurrentUser('id') userId: string) {
    return this.webauthnService.listCredentials(userId);
  }

  @Delete('credentials/:id')
  @ApiOperation({ summary: 'Revoke an app-lock credential' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.webauthnService.deleteCredential(userId, id);
  }
}
