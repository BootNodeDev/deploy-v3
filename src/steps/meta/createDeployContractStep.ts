import { Contract, ContractInterface, ContractFactory } from '@ethersproject/contracts'
import { MigrationConfig, MigrationState, MigrationStep } from '../../migrations'
import linkLibraries from '../../util/linkLibraries'
import { Deployer } from '@matterlabs/hardhat-zksync-deploy'
import { Signer } from '@ethersproject/abstract-signer'
import { Wallet as ZkSyncWallet, Contract as ZkContract } from 'zksync-web3'
import hre from 'hardhat'

type ConstructorArgs = (string | number | string[] | number[])[]
type Artifact = {
  contractName: string
  abi: ContractInterface
  bytecode: string
  linkReferences?: { [fileName: string]: { [contractName: string]: { length: number; start: number }[] } }
}

export default function createDeployContractStep({
  key,
  artifact: { contractName, abi, bytecode, linkReferences },
  useZkSync = false,
  computeLibraries,
  computeArguments,
}: {
  key: keyof MigrationState
  artifact: Artifact
  useZkSync?: boolean
  computeLibraries?: (state: Readonly<MigrationState>, config: MigrationConfig) => { [libraryName: string]: string }
  computeArguments?: (state: Readonly<MigrationState>, config: MigrationConfig) => ConstructorArgs
}): MigrationStep {
  if (linkReferences && Object.keys(linkReferences).length > 0 && !computeLibraries) {
    throw new Error('Missing function to compute library addresses')
  } else if (computeLibraries && (!linkReferences || Object.keys(linkReferences).length === 0)) {
    throw new Error('Compute libraries passed but no link references')
  }

  return async (state, config) => {
    if (state[key] === undefined) {
      const constructorArgs: ConstructorArgs = computeArguments ? computeArguments(state, config) : []

      let contract: Contract | ZkContract
      console.log({ useZkSync })
      if (!useZkSync) {
        console.log(`normal deploy ${contractName}`)

        const factory = new ContractFactory(
          abi,
          linkReferences && computeLibraries
            ? linkLibraries({ bytecode, linkReferences }, computeLibraries(state, config))
            : bytecode,
          config.signer as Signer
        )

        try {
          contract = await factory.deploy(...constructorArgs, { gasPrice: config.gasPrice })
        } catch (error) {
          console.error(`Failed to deploy ${contractName}`)
          throw error
        }
      } else {
        console.log(`zkSync deploy ${contractName}`)
        const deployer = new Deployer(hre, config.signer as ZkSyncWallet)

        // This should look for artifacts-zk based on contractNames
        // retrieved on MIGRATION_STEPS @uniswap contracts
        const zkArtifact = await deployer.loadArtifact(contractName)

        contract = await deployer.deploy(zkArtifact, [constructorArgs])
      }
      state[key] = contract.address

      return [
        {
          message: `Contract ${contractName} deployed`,
          address: contract.address,
          hash: contract.deployTransaction.hash,
        },
      ]
    } else {
      return [{ message: `Contract ${contractName} was already deployed`, address: state[key] }]
    }
  }
}
