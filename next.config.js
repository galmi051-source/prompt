/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Reactの厳格モードを有効にする
  // 環境変数を公開するために必要 (Next.js 12以前ではpublicRuntimeConfig, Next.js 13以降は自動的にNEXT_PUBLIC_接頭辞で公開される)
  env: {
    // これらの環境変数はすでに.env.localで設定されているため、ここでは特に記述不要です。
    // Next.jsはNEXT_PUBLIC_で始まる変数を自動的にクライアントサイドに公開します。
  },
};

module.exports = nextConfig;
