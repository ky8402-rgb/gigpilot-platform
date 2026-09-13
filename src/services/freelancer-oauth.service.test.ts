/**
 * Unit Tests for Freelancer OAuth 2.0 Service
 * Tests: src/services/freelancer-oauth.service.ts
 */

import axios from 'axios';
import {
  FreelancerOAuthService,
  FreelancerOAuthTokenData,
} from './freelancer-oauth.service';

export async function runOAuthUnitTests(): Promise<{
  passed: number;
  failed: number;
  results: { testName: string; success: boolean; error?: string }[];
}> {
  const results: { testName: string; success: boolean; error?: string }[] = [];
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      results.push({ testName: name, success: true });
    } catch (err: any) {
      failed++;
      results.push({ testName: name, success: false, error: err?.message || String(err) });
    }
  }

  const oauthService = new FreelancerOAuthService();

  // Test 1: CSRF State Generation and Validation
  await test('generateState produces high-entropy state and consumes it once', () => {
    const state = oauthService.generateState({ userId: 'u123', returnTo: '/bids' });
    if (!state || state.length < 16) {
      throw new Error(`Generated state is too short or empty: ${state}`);
    }

    // First validation should succeed
    const firstValidation = oauthService.validateAndConsumeState(state);
    if (!firstValidation.valid) {
      throw new Error(`Validation failed: ${firstValidation.error}`);
    }
    if (firstValidation.payload?.userId !== 'u123') {
      throw new Error(`State payload not preserved: ${JSON.stringify(firstValidation.payload)}`);
    }

    // Second validation of the same state MUST fail (one-time consumption / replay protection)
    const replayValidation = oauthService.validateAndConsumeState(state);
    if (replayValidation.valid) {
      throw new Error('Replay attack was not blocked! State should have been consumed.');
    }
  });

  // Test 2: Token Storage and Expiration Detection
  await test('saveTokens, getTokens, and isTokenExpired work accurately', () => {
    oauthService.clearTokens();
    if (oauthService.isAuthenticated()) {
      throw new Error('Expected unauthenticated after clearTokens');
    }

    const testToken: Partial<FreelancerOAuthTokenData> = {
      accessToken: 'test_access_token_123',
      refreshToken: 'test_refresh_token_456',
      tokenType: 'Bearer',
      expiresIn: 3600, // 1 hour
      username: 'testuser',
    };

    const saved = oauthService.saveTokens(testToken);
    if (saved.accessToken !== 'test_access_token_123') {
      throw new Error('Access token mismatch');
    }
    if (!oauthService.isAuthenticated()) {
      throw new Error('Expected authenticated after saving token');
    }
    if (oauthService.isTokenExpired(60)) {
      throw new Error('Token should not be expired with 1 hour remaining');
    }

    // Test token expiring soon (within 30 seconds)
    oauthService.saveTokens({
      accessToken: 'expiring_token',
      expiresAt: Date.now() + 20 * 1000, // 20s left
    });

    if (!oauthService.isTokenExpired(60)) {
      throw new Error('Token with 20s remaining should be flagged as expired with 60s buffer');
    }

    oauthService.clearTokens();
  });

  // Test 3: generateAuthorizationUrl creates well-formed URL with CSRF state
  await test('generateAuthorizationUrl produces compliant OAuth 2.0 URL', async () => {
    const authUrlString = await oauthService.generateAuthorizationUrl({
      clientId: 'test_app_id_999',
      redirectUri: 'https://3-222-149-9.sslip.io/api/freelancer/oauth2/callback',
      scopes: ['basic', 'profile', 'projects'],
    });

    const url = new URL(authUrlString);
    if (url.origin !== 'https://accounts.freelancer.com') {
      throw new Error(`Unexpected origin: ${url.origin}`);
    }
    if (url.pathname !== '/oauth/authorise') {
      throw new Error(`Unexpected pathname: ${url.pathname}`);
    }
    if (url.searchParams.get('response_type') !== 'code') {
      throw new Error('response_type should be "code"');
    }
    if (url.searchParams.get('client_id') !== 'test_app_id_999') {
      throw new Error('client_id mismatch');
    }
    const stateParam = url.searchParams.get('state');
    if (!stateParam) {
      throw new Error('state parameter missing from auth URL');
    }

    // Verify the state parameter is valid and can be consumed
    const validation = oauthService.validateAndConsumeState(stateParam);
    if (!validation.valid) {
      throw new Error(`Generated URL state was invalid: ${validation.error}`);
    }
  });

  // Test 4: Axios Interceptor Bearer Token Attachment
  await test('createOAuthAxios automatically injects Bearer token into outgoing headers', async () => {
    oauthService.saveTokens({
      accessToken: 'bearer_token_secret_xyz',
      refreshToken: 'refresh_token_secret_abc',
      expiresIn: 3600,
    });

    let interceptedAuthHeader = '';

    const client = oauthService.createOAuthAxios({
      adapter: async (config) => {
        interceptedAuthHeader = String(config.headers?.get('Authorization') || config.headers?.['Authorization'] || '');
        return {
          data: { status: 'success' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    await client.get('https://api.freelancer.com/api/users/0.1/self');

    if (interceptedAuthHeader !== 'Bearer bearer_token_secret_xyz') {
      throw new Error(`Expected "Bearer bearer_token_secret_xyz", got: "${interceptedAuthHeader}"`);
    }

    oauthService.clearTokens();
  });

  // Test 5: Response Interceptor 401 recovery and retry
  await test('response interceptor catches 401, invokes refreshToken, and retries request', async () => {
    oauthService.saveTokens({
      accessToken: 'initial_expired_token',
      refreshToken: 'valid_refresh_token',
      expiresIn: 3600,
    });

    let refreshCalled = false;
    // Mock the refreshToken method on this test instance
    const originalRefresh = oauthService.refreshToken.bind(oauthService);
    oauthService.refreshToken = async () => {
      refreshCalled = true;
      return oauthService.saveTokens({
        accessToken: 'newly_refreshed_access_token',
        refreshToken: 'valid_refresh_token',
        expiresIn: 3600,
      });
    };

    let attempts = 0;
    let finalAuthHeader = '';

    const client = oauthService.createOAuthAxios({
      adapter: async (config) => {
        attempts++;
        if (attempts === 1) {
          // First attempt fails with 401
          const error: any = new Error('Request failed with status code 401');
          error.response = {
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            data: { message: 'Token expired' },
            config,
          };
          error.config = config;
          throw error;
        }

        // Second attempt succeeds with new token
        finalAuthHeader = String(config.headers?.get('Authorization') || config.headers?.['Authorization'] || '');
        return {
          data: { status: 'refreshed_success' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    const response = await client.get('https://api.freelancer.com/api/projects/0.1/projects/active');

    if (!refreshCalled) {
      throw new Error('Expected refreshToken to be triggered upon 401');
    }
    if (attempts !== 2) {
      throw new Error(`Expected 2 attempts (initial 401 + retry), but had ${attempts}`);
    }
    if (finalAuthHeader !== 'Bearer newly_refreshed_access_token') {
      throw new Error(`Expected retry header "Bearer newly_refreshed_access_token", got: "${finalAuthHeader}"`);
    }
    if (response.data?.status !== 'refreshed_success') {
      throw new Error('Did not receive success response after retry');
    }

    // Restore and cleanup
    oauthService.refreshToken = originalRefresh;
    oauthService.clearTokens();
  });

  return { passed, failed, results };
}
