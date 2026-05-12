// pages/_app.js
import '../styles/globals.css';
import ChatWidget from '../components/ChatWidget';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <ChatWidget />
    </>
  );
}
