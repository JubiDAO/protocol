export interface DeployedContracts {
  // SAFTLEY_TOKEN: string,
  PRESALE: string;
  USDC: string;
  OWNER: string;
}

export const DEPLOYED_CONTRACTS: { [key: string]: DeployedContracts } = {
  mainnet: {
    PRESALE: '',
    USDC: '',
    OWNER: '',
  },
  rinkeby: {
    PRESALE: '',
    USDC: '',
    OWNER: '',
  },
  localhost: {
    PRESALE: process.env.PRESALE || '',
    USDC: process.env.USDC || '',
    OWNER: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', // Account #0
  },
};
