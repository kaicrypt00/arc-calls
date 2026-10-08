const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // Arc testnet USDC address — update with mainnet address before production deploy
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000000"; // TODO
  const FEE_RECIPIENT = deployer.address; // TODO: set to multisig

  // 1. Deploy Profile
  console.log("\nDeploying Profile...");
  const Profile = await hre.ethers.getContractFactory("Profile");
  const profile = await Profile.deploy();
  await profile.waitForDeployment();
  console.log("Profile deployed to:", await profile.getAddress());

  // 2. Deploy BettingPool
  console.log("\nDeploying BettingPool...");
  const BettingPool = await hre.ethers.getContractFactory("BettingPool");
  const bettingPool = await BettingPool.deploy(USDC_ADDRESS, FEE_RECIPIENT);
  await bettingPool.waitForDeployment();
  console.log("BettingPool deployed to:", await bettingPool.getAddress());

  // 3. Deploy Poll
  console.log("\nDeploying Poll...");
  const Poll = await hre.ethers.getContractFactory("Poll");
  const poll = await Poll.deploy(USDC_ADDRESS);
  await poll.waitForDeployment();
  console.log("Poll deployed to:", await poll.getAddress());

  // 4. Wire up contracts
  console.log("\nWiring contracts...");
  await poll.setBettingPool(await bettingPool.getAddress());
  await profile.authorizeMinter(await bettingPool.getAddress());
  console.log("Done.");

  console.log("\n──────────────────────────────────────────");
  console.log("Deployment Summary:");
  console.log("  Profile:     ", await profile.getAddress());
  console.log("  BettingPool: ", await bettingPool.getAddress());
  console.log("  Poll:        ", await poll.getAddress());
  console.log("──────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
