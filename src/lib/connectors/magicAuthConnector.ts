import { OAuthExtension, OAuthProvider } from '@magic-ext/oauth';
import {
  InstanceWithExtensions,
  MagicSDKAdditionalConfiguration,
  MagicSDKExtensionsOption,
  SDKBase,
} from '@magic-sdk/provider';
import {
  Address,
  Chain,
  normalizeChainId,
  UserRejectedRequestError,
} from '@wagmi/core';
import { Magic } from 'magic-sdk';

import { MagicConnector, MagicOptions } from './magicConnector';

interface MagicAuthOptions extends MagicOptions {
  enableEmailLogin?: boolean;
  enableSMSLogin?: boolean;
  oauthOptions?: {
    providers: OAuthProvider[];
    callbackUrl?: string;
  };
  magicSdkConfiguration?: MagicSDKAdditionalConfiguration<
    string,
    OAuthExtension[]
  >;
}

export class MagicAuthConnector extends MagicConnector {
  magicSDK?: InstanceWithExtensions<SDKBase, OAuthExtension[]>;

  magicSdkConfiguration: MagicSDKAdditionalConfiguration<
    string,
    MagicSDKExtensionsOption<OAuthExtension['name']>
  >;

  enableSMSLogin: boolean;

  enableEmailLogin: boolean;

  oauthProviders: OAuthProvider[];

  oauthCallbackUrl?: string;

  constructor(config: { chains?: Chain[]; options: MagicAuthOptions }) {
    super(config);
    this.magicSdkConfiguration = config.options.magicSdkConfiguration;
    this.oauthProviders = config.options.oauthOptions?.providers || [];
    this.oauthCallbackUrl = config.options.oauthOptions?.callbackUrl;
    this.enableSMSLogin = config.options.enableSMSLogin;
    this.enableEmailLogin = config.options.enableEmailLogin;
  }

  async connect() {
    try {
      const provider = await this.getProvider();

      if (provider.on) {
        provider.on('accountsChanged', this.onAccountsChanged);
        provider.on('chainChanged', this.onChainChanged);
        provider.on('disconnect', this.onDisconnect);
      }

      // Check if there is a user logged in
      const isAuthenticated = await this.isAuthorized();

      // Check if we have a chainId, in case of error just assign 0 for legacy
      let chainId: number;
      try {
        chainId = await this.getChainId();
      } catch (e) {
        chainId = 0;
      }

      // if there is a user logged in, return the user
      if (isAuthenticated) {
        return {
          provider,
          chain: {
            id: chainId,
            unsupported: false,
          },
          account: await this.getAccount(),
        };
      }

      // open the modal and process the magic login steps
      if (!this.isModalOpen) {
        const output = await this.getUserDetailsByForm(
          this.enableSMSLogin,
          this.enableEmailLogin,
          this.oauthProviders
        );
        const magic = this.getMagicSDK();

        // LOGIN WITH MAGIC LINK WITH OAUTH PROVIDER
        if (output.oauthProvider) {
          await magic.oauth.loginWithRedirect({
            provider: output.oauthProvider,
            redirectURI: this.oauthCallbackUrl || window.location.href,
          });
        }

        // LOGIN WITH MAGIC LINK WITH EMAIL
        if (output.email) {
          await magic.auth.loginWithMagicLink({
            email: output.email,
          });
        }

        // LOGIN WITH MAGIC LINK WITH PHONE NUMBER
        if (output.phoneNumber) {
          await magic.auth.loginWithSMS({
            phoneNumber: output.phoneNumber,
          });
        }

        const signer = await this.getSigner();
        let account = (await signer.getAddress()) as Address;
        if (!account.startsWith('0x')) account = `0x${account}`;

        return {
          account,
          chain: {
            id: chainId,
            unsupported: false,
          },
          provider,
        };
      }
      throw new UserRejectedRequestError('User rejected request');
    } catch (error) {
      throw new UserRejectedRequestError('Something went wrong');
    }
  }

  async getChainId(): Promise<number> {
    const networkOptions = this.magicSdkConfiguration?.network;
    if (typeof networkOptions === 'object') {
      const chainID = networkOptions.chainId;
      if (chainID) {
        return normalizeChainId(chainID);
      }
    }
    throw new Error('Chain ID is not defined');
  }

  getMagicSDK(): InstanceWithExtensions<SDKBase, OAuthExtension[]> {
    if (!this.magicSDK) {
      this.magicSDK = new Magic(this.magicOptions.apiKey, {
        ...this.magicSdkConfiguration,
        extensions: [new OAuthExtension()],
      });
      return this.magicSDK;
    }
    return this.magicSDK;
  }
}
