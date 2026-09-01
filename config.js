/* =====================================================================
   MUÑIZ PEDIDOS - CONFIGURACION (editar SOLO este archivo)
   Como editar en GitHub: abre config.js -> icono del lapiz ->
   cambia el numero -> Commit changes. Los telefonos se actualizan solos.
   Formato de telefono: 1 + codigo de area + numero, SIN espacios ni
   guiones. Ejemplo: "15125551234". Si se deja "" (vacio), el mensaje
   se abre sin destinatario y la persona escoge el contacto.
   ===================================================================== */
window.MUNIZ_CONFIG = {

  /* Telefono de Tito (recibe los pedidos APROBADOS) */
  TITO_PHONE: "15129651933",

  /* Mayordomos que ven el catalogo BILINGUE (español + inglés) automaticamente.
     Cualquiera puede prenderlo con el boton "EN" en la franja de la tienda. */
  BILINGUES: ["PEDRO LIMON"],

  /* Telefonos de los 5 supervisores (reciben pedidos para APROBAR) */
  SUPERVISORES: {
    "MIGUEL JUAREZ":       "15128004698",
    "TACHO HERNANDEZ":     "15129687598",
    "JOSE LUIS ZAMARRIPA": "15125178361",
    "MARTIN GONZALEZ":     "15124366311",
    "LUPE JUAREZ":         "15124662909"
  },

  /* Quien aprueba a quien - del 6-Week Lookahead 8/21/2026 */
  ASIGNACIONES: {
    "ALVARO AGUIRRE":        "TACHO HERNANDEZ",
    "FRANCISCO AGUIRRE":     "TACHO HERNANDEZ",
    "ENRIQUE ALVARADO":      "MIGUEL JUAREZ",
    "FRANCISCO BOCANEGRA":   "MARTIN GONZALEZ",
    "RUBEN CANO":            "LUPE JUAREZ",
    "CARLOS DIAZ":           "MIGUEL JUAREZ",
    "JULIAN GONZALEZ":       "JOSE LUIS ZAMARRIPA",
    "OMAR ALFREDO HERNANDEZ":"JOSE LUIS ZAMARRIPA",
    "JOSE GUADALUPE JUAREZ": "LUPE JUAREZ",
    "PEDRO LIMON":           "MIGUEL JUAREZ",
    "DAVID MOLINA":          "JOSE LUIS ZAMARRIPA",
    "SERGIO NINO":           "MIGUEL JUAREZ",
    "DANIEL ORTEGA":         "TACHO HERNANDEZ",
    "JUAN PEREZ":            "MARTIN GONZALEZ",
    "HERVEY QUINTERO":       "MARTIN GONZALEZ",
    "GIOVANNI RODRIGUEZ":    "TACHO HERNANDEZ",
    "GERARDO SANCHEZ":       "MIGUEL JUAREZ",
    "ISIDRO SANCHEZ":        "JOSE LUIS ZAMARRIPA",
    "RICARDO SANCHEZ":       "TACHO HERNANDEZ",
    "VICTOR SANCHEZ":        "JOSE LUIS ZAMARRIPA",
    "DIEGO VAZQUEZ":         "MARTIN GONZALEZ",
    "JOSE ZAMARRIPA":        "MARTIN GONZALEZ"
  },

  /* OPCIONAL: telefonos de mayordomos (para avisos de RECHAZO directos) */
  MAYORDOMOS: {}
};
