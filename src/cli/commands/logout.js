import { clearAuth, readUserConfig } from "../../config/userConfig.js";

export const command = "logout";
export const describe = "Remove the saved login from this computer";

export const handler = () => {
  const { token } = readUserConfig();
  clearAuth();
  console.log(token ? "Signed out. Your notes stay on this computer and come back when you sign in again (devvault login)." : "You were not signed in.");
};
