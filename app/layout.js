import './globals.css';

export const metadata = {
  title: 'Escarlate Finder',
  description: 'Ferramenta de prospecção de leads para venda de sites',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
