import { Link } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav>
      <Link to="/">Accueil</Link>
      <Link to="/carte">Carte</Link>
      <Link to="/jeux">Jeux</Link>
      <Link to="/cours">Cours</Link>
    </nav>
  )
}
