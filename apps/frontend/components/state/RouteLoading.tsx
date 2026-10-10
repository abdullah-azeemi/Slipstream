export default function RouteLoading() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 48 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid #E2E8F0', borderTopColor: '#E8002D', animation: 'pw-spin 0.8s linear infinite' }} />
      <div style={{ fontSize: 12, color: '#64748B', letterSpacing: '0.06em' }}>Loading...</div>
      <style>{`@keyframes pw-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}