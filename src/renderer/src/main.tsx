import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import './styles.css'
import { App } from './App'

/** If the interface itself fails, say so and offer a reload. Seals keep running in the main process. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" role="alert" style={{ padding: 32, maxWidth: '60ch' }}>
        <p className="echo-title">R.R. could not draw this screen.</p>
        <p>Your seals and waterline are unaffected; they run in the background. Reloading usually fixes this.</p>
        <p className="tag">{this.state.error.message}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>
)
