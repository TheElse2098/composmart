import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Layout/Navbar'
import Home from './pages/Home'
import MapPage from './pages/MapPage'
import GamesPage from './pages/GamesPage'
import CoursesPage from './pages/CoursesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/carte" element={<MapPage />} />
        <Route path="/jeux" element={<GamesPage />} />
        <Route path="/cours" element={<CoursesPage />} />
      </Routes>
    </BrowserRouter>
  )
}
