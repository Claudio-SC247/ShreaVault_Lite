import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172126",
        mist: "#f4f7f6",
        pine: "#17624f",
        coral: "#c4513f",
        amber: "#b27618"
      }
    }
  },
  plugins: []
};

export default config;

