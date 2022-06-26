export interface DeployedContracts {
  PRESALE: string,
  USDC: string,
  DAO_MULTISIG: string,
}

export const DEPLOYED_CONTRACTS: {[key: string]: DeployedContracts} = {
  mainnet: {
    PRESALE: '0xF2d77A3b88668c0FA1B9B5cc0ffde90D3DFAaBaE',

    // part of mainnet Environment
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    DAO_MULTISIG: '0x7a77daeA5cA35a83BF529B9d72740fB965cCC5E6',
  },
  rinkeby: {
    PRESALE: '',
    USDC: '0xD92E713d051C37EbB2561803a3b5FBAbc4962431',
    DAO_MULTISIG: '',
  },
  localhost: {
    PRESALE: process.env.PRESALE || '',
    USDC: process.env.USDC || '',
    DAO_MULTISIG: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', // Account #0
  }
}
