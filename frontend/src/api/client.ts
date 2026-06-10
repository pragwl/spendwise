import axios, { AxiosError } from "axios";
import { config } from "../config";

export const client = axios.create({
  baseURL: config.api.baseUrl,
  timeout: config.api.timeout,
  headers: { "Content-Type": "application/json" },
});

client.interceptors.response.use(
  res => res.data,
  (err: AxiosError<{ error?: { message: string; code: string } }>) => {
    const message =
      err.response?.data?.error?.message ||
      err.message ||
      "Something went wrong";
    return Promise.reject(new Error(message));
  }
);
