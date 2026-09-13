export default {
  paths: {
    cache: process.env.MANGA_HARDHAT_CACHE || './cache',
  },
  solidity: {
    version: '0.8.26',
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
}
