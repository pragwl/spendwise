export const config = {
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || "/api/v1",
    timeout: 15000,
  },
  app: {
    name:     import.meta.env.VITE_APP_NAME    || "SpendWise",
    version:  import.meta.env.VITE_APP_VERSION || "1.0.0",
    currency: "₹",
    locale:   "en-IN",
  },
  pagination: {
    defaultLimit: 50,
  },
};
