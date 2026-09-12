// Relay web client — reuses the same component/data patterns as the mobile app
// (architecture doc, section 4). Chat list / chat window / auth screens land
// alongside the messaging-service integration.

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Relay</h1>
      <p>Web client scaffold — messaging UI lands with the Phase 1 messaging service.</p>
    </div>
  );
}
