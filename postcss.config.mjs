// postcss.config.mjs

// ES Modules形式でPostCSSの設定を記述します。
// プラグインは文字列（モジュール名）として指定します。

const config = {
  plugins: {
    // TailwindCSSプラグインを有効にします。
    // Next.jsの内部でtailwindcssパッケージが解決されます。
    tailwindcss: {},
    // Autoprefixerプラグインを有効にします。
    // CSSにベンダープレフィックスを自動で付与します。
    autoprefixer: {},
  },
};

export default config;
