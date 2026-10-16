import { AppHeader } from '../components/AppHeader/AppHeader'
import { StatusBar } from '../components/StatusBar/StatusBar'
import { Toolbar } from '../components/Toolbar/Toolbar'
import { Workspace } from '../components/Workspace/Workspace'
import './App.css'

function App() {
  return (
    <div className="app">
      <AppHeader />
      <Toolbar />
      <Workspace />
      <StatusBar />
    </div>
  )
}

export default App
