import {
  initializeStorage,
  isInitialized
} from "../../storage/localStorage.js";

export const command = "init";

export const describe =
  "Initialize DevVault in the current directory";

export const handler = () => {
  if (isInitialized()) {
    console.log("DevVault is already initialized.");
    return;
  }

  initializeStorage();

  console.log("DevVault initialized successfully.");
  console.log("Created .devvault/ in the current directory.");
};