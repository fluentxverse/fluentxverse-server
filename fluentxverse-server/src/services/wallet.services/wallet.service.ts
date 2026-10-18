import { gmrEngine } from "../web3.services/gmrEngine.service";

class WalletService {
  public async createServerWallet(label: string, email?: string) {
    const wallet = await gmrEngine.createManagedUserWallet({
      authProvider: 'fluentxverse_email',
      email,
      metadata: JSON.stringify({ label }),
      userID: label,
    });

    return {
      ...wallet,
      smartAccountAddress: wallet.address,
    };
  }
}

export default WalletService;
