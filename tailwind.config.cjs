module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111a24',
        canvas: '#f4f6f8',
        accent: '#e88936'
      },
      boxShadow: {
        panel: '0 12px 32px rgba(17, 26, 36, 0.06)'
      }
    }
  },
  plugins: []
};
