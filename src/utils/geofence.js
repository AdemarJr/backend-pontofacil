// src/utils/geofence.js

// Calcula distância entre dois pontos GPS em metros (fórmula de Haversine)
function calcularDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Raio da Terra em metros
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// Retorna true se o ponto está dentro do raio configurado
function validarGeofence(latColaborador, lngColaborador, latEmpresa, lngEmpresa, raioMetros) {
  const distancia = calcularDistancia(
    parseFloat(latColaborador), parseFloat(lngColaborador),
    parseFloat(latEmpresa), parseFloat(lngEmpresa)
  );
  return distancia <= raioMetros;
}

module.exports = { validarGeofence, calcularDistancia };
