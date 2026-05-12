// pages/widget.js
// Served at /widget — loaded inside iframe on static HTML pages
import ChatWidget from '../components/ChatWidget';

export default function WidgetPage() {
  return (
    <div style={{ background: 'transparent', minHeight: '100vh' }}>
      <ChatWidget />
    </div>
  );
}
