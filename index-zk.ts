import { program } from 'commander'
import { Wallet as ZkSyncWallet } from 'zksync-web3'
import { TransactionReceipt } from '@ethersproject/providers'
import { getAddress } from '@ethersproject/address'
import { AddressZero } from '@ethersproject/constants'
import fs from 'fs'
import deploy from './src/deploy'
import { MigrationState } from './src/migrations'
import { version } from './package.json'

const TIMEOUT_CONFIRMATIONS = /* 15 minutes */ 1000 * 60 * 15
const CONFIRMATIONS = 3

program.name('npx @uniswap/deploy-zk-v3').version(version).parse(process.argv)

let privateKey: string
console.log(process.env.PK)
if (process.env.PK === undefined || !/^[a-zA-Z0-9]{64}$/.test(process.env.PK)) {
  console.error('Invalid private key!')
  process.exit(1)
} else {
  privateKey = process.env.PK
}
const nativeCurrencyLabelBytes = 'ETH'

let weth9Address: string
try {
  weth9Address = getAddress(process.env.WETH_ADDRESS ?? '')
} catch (error) {
  console.error('Invalid WETH9 address', (error as Error).message)
  process.exit(1)
}

let ownerAddress: string
try {
  ownerAddress = getAddress(process.env.OWNER_ADDRESS ?? '')
} catch (error) {
  console.error('Invalid owner address', (error as Error).message)
  process.exit(1)
}

const wallet = new ZkSyncWallet(privateKey)
const useZkSync = true
const gasPrice = undefined
const v2CoreFactoryAddress = AddressZero

// Persist migration state
let state: MigrationState
if (fs.existsSync(program.state)) {
  try {
    state = JSON.parse(fs.readFileSync(program.state, { encoding: 'utf8' }))
  } catch (error) {
    console.error('Failed to load and parse migration state file', (error as Error).message)
    process.exit(1)
  }
} else {
  state = {}
}

let finalState: MigrationState
const onStateChange = async (newState: MigrationState): Promise<void> => {
  fs.writeFileSync(program.state, JSON.stringify(newState))
  finalState = newState
}

async function run() {
  let step = 1
  const results = []

  console.log({ useZkSync })
  const generator = deploy({
    signer: wallet,
    useZkSync,
    gasPrice,
    nativeCurrencyLabelBytes,
    v2CoreFactoryAddress,
    ownerAddress,
    weth9Address,
    initialState: state,
    onStateChange,
  })

  for await (const result of generator) {
    console.log(`Step ${step++} complete`, result)
    results.push(result)

    // wait 15 minutes for any transactions sent in the step
    await Promise.all(
      result.map(
        (stepResult): Promise<TransactionReceipt | true> => {
          if (stepResult.hash) {
            return wallet.provider.waitForTransaction(stepResult.hash, CONFIRMATIONS, TIMEOUT_CONFIRMATIONS)
          } else {
            return Promise.resolve(true)
          }
        }
      )
    )
  }

  return results
}

run()
  .then((results) => {
    console.log('Deployment succeeded')
    console.log(JSON.stringify(results))
    console.log('Final state')
    console.log(JSON.stringify(finalState))
    process.exit(0)
  })
  .catch((error) => {
    console.error('Deployment failed', error)
    console.log('Final state')
    console.log(JSON.stringify(finalState))
    process.exit(1)
  })
