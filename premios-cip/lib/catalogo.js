// Catálogo inicial: premios CIP 2026 + artículos Hilti. [nombre, puntos, máximo por persona]
const crypto = require('crypto');

function uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

const CATALOGO_INICIAL = {
  anio: 'Premios CIP 2026',
  premios: [
    ['Lonchera térmica con set de cubiertos', 85], ['Batería portátil', 85], ['Wafflera eléctrica', 85], ['Hielera portátil', 85], ['Juego de 10 recipientes de vidrio', 85], ['Termo Owala', 85],
    ['Llavero Hilti sierra', 10, 2], ['Llavero Hilti destapador (gorra)', 15, 2],
    ['Airtag 4 piezas', 200], ['Juego de 3 maletas de viaje', 200], ['Tostador digital', 200], ['JBL portátil', 200], ['Bolsa de herramientas Hilti chica', 200], ['Set de puntas Hilti Bit-Set Compact', 200], ['Set de puntas Hilti Compact Uni Impact', 200],
    ['Toldo plegable 3x3 + 2 sillas + 1 mesa', 300], ['Mirage horno microondas', 300], ['HomePod Apple', 300], ['Multicargador inalámbrico', 300], ['Bolsa de herramientas Hilti grande', 300],
    ['Mini dron con cámara', 400], ['Auriculares Beats Studio', 400], ['Lonchera Stanley', 400], ['Proyector portátil inteligente', 400],
    ['Bocina Partybox Club', 450], ['Nintendo Switch', 450], ['iPad 11.ª generación', 450], ['Samsung Galaxy A56 128 GB', 450], ['Estuche de puntas Hilti enrollable', 450],
    ['Taladro alámbrico Hilti', 600, 2],
    ['Sierra circular Hilti', 800, 2], ['Atornillador de impacto Hilti', 800, 2], ['Taladro inalámbrico Hilti con cabezales intercambiables', 800, 2],
  ],
};

module.exports = { CATALOGO_INICIAL, uid };
