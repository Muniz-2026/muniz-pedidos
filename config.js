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

  /* =====================================================================
     BASE DE DATOS (Supabase). Con esto el PO de combustible se registra
     EN EL INSTANTE en que se genera, sin textos. Es el corazon del sistema.
     Supabase -> Project Settings -> API:
        URL      = "Project URL"          (https://xxxxxxxx.supabase.co)
        ANON_KEY = "anon public" key       (empieza con eyJ...)
     La anon key es publica a proposito: solo puede INSERTAR registros y leer
     catalogos. Leer el registro completo requiere el login de oficina. */
  SUPABASE: {
    URL:      "https://kchnylxocdniacpfugyf.supabase.co",
    ANON_KEY: "sb_publishable_4z755311D1gF3oLmlQhksw_yn10-mpZ",
  },

  /* ===== USUARIO MAESTRO (solo el ve MODO OFICINA) =====
     OFFICE_PIN: clave de 4 digitos. Para cambiarla, cambia el numero de abajo.
     ATENCION: este archivo es publico en GitHub. Cualquiera que sepa buscar
     puede leer esta clave. Sirve para que un mayordomo no entre por error,
     NO es seguridad de verdad. NO usar la misma clave del telefono. */
  /* ===== USUARIOS DE OFICINA (cada uno con su propia clave) =====
     Solo estas personas ven MODO OFICINA. Su nombre aparece en la lista de
     nombres como cualquier otro, sin nada que llame la atencion; al tocarlo
     pide SU clave. Para agregar o quitar gente, edita esta lista.
     ATENCION: este archivo es publico en GitHub - la clave se puede leer.
     Sirve para que un mayordomo no entre por error, NO es seguridad real.
     NO usar la misma clave que abre el telefono. */
  OFICINA: {
    "TITO CUETO":     "4605",
    "CLAUDIA TAMAYO": "2025",
  },

  /* ===== UNA PERSONA, DOS NOMBRES =====
     Si alguien aparece con dos nombres distintos (en la flota, en el rol, en
     las facturas), aqui se dice cual es el mismo. Izquierda: el otro nombre.
     Derecha: el nombre bueno, el que sale en el app. */
  ALIAS: {
    "JOSE GUADALUPE JUAREZ": "LUPE JUAREZ",
  },

  /* ===== PERSONAL QUE NO ES MAYORDOMO =====
     Gente que pide material o combustible pero no es mayordomo: choferes,
     taller, yarda, ayudantes. Aparecen en la MISMA lista de nombres que los
     mayordomos, sin nada que los distinga. Para agregar a alguien, escribe su
     nombre aqui abajo entre comillas y una coma al final.
     NO importa si escribes Gonzales o Gonzalez, Nino o Nino, con o sin acento:
     el app reconoce a la persona igual. Tampoco importa si aqui esta escrito de
     una forma y en FLOTA de otra - se enlazan solos. */
  PERSONAL: [
    "ABRAHAM GONZALES",
    "ULISES LARA",
    "HECTOR SEGURA",
    "ENRIQUE CHAPA",          /* coordinador de operaciones */
    "JOSE DE LA CERDA",       /* choferes de camion (dump truck): ver CHOFERES_CAMION abajo */
    "ROGELIO LOPEZ",
    "FRANCIS ECHEVESTRE",
    "JOSE ANTONIO LICEA",
  ],

  /* ===== GERENTES DE PROYECTO =====
     Su pedido va DIRECTO a la oficina (no pasa por supervisor),
     igual que los supervisores. Aparecen en su propia seccion.
     COMBUSTIBLE: todos traen camioneta de gasolina, asi que el app no les
     pregunta que van a cargar - solo donde, placa y odometro. */
  GERENTES: {
    "HECTOR MANZANARES":  "",
    "SIMON MARTINEZ":     "",
    "MARIO MUNOZ":        "",
    "HUGO CARLINO":       "",
    "EDUARDO VALENZUELA": "",
    "LUIS PEREZ":         "",
  },

  /* =====================================================================
     COMBUSTIBLE  (fuel.html)  -  reglas de Rudy Muniz
     Cada PO de combustible exige: quien, que vehiculo/equipo (placa o
     numero), tipo de combustible (lo fija el registro, no la persona),
     odometro (vehiculo) u horas (maquinaria), OBRA (lugar, no contrato),
     y estacion. Se genera solo, sin supervisor, y queda en el registro.
     ===================================================================== */
  COMBUSTIBLE: {
    /* A donde llega automaticamente CADA PO de combustible (el registro). */
    LOG_TEL: "15129651933",

    /* ===== REGISTRO AUTOMATICO (lo mas importante) =====
       Si aqui va una URL, CADA PO se registra solo, sin que la persona mande
       nada. Es lo que hace imposible saltarse el control.
       Como se hace (10 minutos, gratis, una sola vez):
         1. Hoja de Google nueva -> Extensiones -> Apps Script
         2. Pegar:
              function doGet(e){
                var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PO") ||
                        SpreadsheetApp.getActiveSpreadsheet().insertSheet("PO");
                if (h.getLastRow() === 0) h.appendRow(["po","fecha","quien","vehiculo","tipo",
                  "combustible","placa","equipo","lectura","obra","obra_semana","estacion","alertas"]);
                var p = e.parameter;
                h.appendRow([p.po, new Date(Number(p.ts)), p.who, p.veh, p.tipo, p.comb, p.placa,
                  p.equipo, p.lectura, p.obra, p.obraSemana, p.est, p.flags]);
                return ContentService.createTextOutput("ok");
              }
         3. Implementar -> Nueva implementacion -> Aplicacion web
            Ejecutar como: yo    |    Con acceso: cualquier persona
         4. Copiar la URL /exec y pegarla aqui abajo.
       Si se deja vacio, el app usa el candado del PO (ver COMO_PUBLICAR). */
    WEBHOOK: "",

    /* Estaciones. Si "tel" tiene numero, el PO tambien le llega a la estacion
       en el mismo mensaje. Leo's colabora; Tex-Con se deja en blanco si no lo quiere. */
    /* ===== OBRA POR DEFECTO =====
       El app NO le pregunta la obra a nadie: manda la del rol de la semana.
       Si esa persona no trae rol, manda esta. Tiene que estar escrita IGUAL
       que en la lista de OBRAS de abajo, porque el servidor la revisa. */
    OBRA_POR_DEFECTO: "Yarda Muñiz · 7907 S FM 973",

    /* ===== CHOFERES DE CAMION (dump truck) =====
       Solo cargan DIESEL VERDE en su camion, en Tex-Con o Leo's. No piden
       material. Al tocar su nombre el app va DIRECTO a combustible:
       estacion -> placa y odometro -> PO. Sin menu, sin listas, sin escoger.
       El camion se identifica por la PLACA que escriben. Si esa placa esta en
       la tabla vehicles (columna plate de los D-####), el PO cae en esa fila;
       si no, la placa hace su propia unidad CAM-PLACA con su propio odometro.
       Para que caigan en los D-####: pon la placa de cada dump truck en la
       tabla vehicles. El app recuerda la ultima placa de cada chofer. */
    CHOFERES_CAMION: [
      "JOSE DE LA CERDA",
      "ROGELIO LOPEZ",
      "FRANCIS ECHEVESTRE",
      "JOSE ANTONIO LICEA",
    ],

    /* ===== SOLO GASOLINA =====
       Gente que unicamente carga gasolina en SU camioneta. El app no les
       pregunta que van a cargar: estacion -> placa y odometro -> PO.
       Los gerentes de proyecto ya entran aqui solos por su puesto; esta lista
       es para quien no es gerente. Escribe el nombre y una coma. */
    SOLO_GASOLINA: [
      "ENRIQUE CHAPA",
    ],

    ESTACIONES: {
      LEOS:   { nombre: "Leo's Service Station", corto: "LEO'S",   tel: "", color: "#F5B800" },
      TEXCON: { nombre: "Tex-Con Oil",           corto: "TEX-CON", tel: "", color: "#1D4ED8" },
    },

    /* OBRAS = LUGARES (del 6-Week Lookahead). Nunca el numero de contrato. */
    OBRAS: [
      "St Johns Ave","Springdale Rd @ Lyons Rd","Middle Lake","Gonzales Ped Island","Mokan Trail",
      "Violet Crown Trail","Violet Crown Circle C","North Lamar Blvd","Menchaca Rd","Banister Area",
      "Rundberg Rd","Rundberg Rd @ Mearns Meadows","RBJ Health Center","CapMetro","Burnet Rd",
      "Cameron Rd","Niels Thompson Dr @ Longhorn Blvd","Manor Rd","North Cross Dr","Mesa Dr",
      "Duval Rd","Metro Center Dr","Pleasant Valley Ph1","E 12th St @ Chestnut Ave","CAUDI",
      "West 12th St","Howard Ln","Radam Ln & 1st St","Middle Fiskville SUP","EM Franklin Ave",
      "Yarda Muñiz \u00b7 7907 S FM 973"
    ],

    /* Donde esta cada cuadrilla ESTA SEMANA (del 6-Week Lookahead, semana del 7 sep).
       Claudia lo actualiza cada lunes con el correo de ubicaciones. El app lo propone
       primero; la persona lo confirma o cambia. Si cambia, queda marcado. */
    OBRA_SEMANA: {
      "ENRIQUE ALVARADO": "St Johns Ave",           "DANIEL ORTEGA": "Springdale Rd @ Lyons Rd",
      "RUBEN CANO": "Mokan Trail",                  "SERGIO NINO": "Metro Center Dr",
      "ISIDRO SANCHEZ": "North Lamar Blvd",         "GERARDO SANCHEZ": "North Lamar Blvd",
      "DIEGO VAZQUEZ": "Banister Area",             "FRANCISCO AGUIRRE": "Rundberg Rd",
      "VICTOR SANCHEZ": "RBJ Health Center",        "JULIAN GONZALEZ": "CapMetro",
      "GIOVANNI RODRIGUEZ": "Burnet Rd",            "OMAR ALFREDO HERNANDEZ": "Rundberg Rd @ Mearns Meadows",
      "ISIDRO GARCIA": "Burnet Rd",                 "ALVARO AGUIRRE": "Cameron Rd",
      "CARLOS DIAZ": "Niels Thompson Dr @ Longhorn Blvd", "PEDRO LIMON": "North Cross Dr",
      "FRANCISCO BOCANEGRA": "Duval Rd",            "JUAN PEREZ": "Pleasant Valley Ph1",
      "DAVID MOLINA": "E 12th St @ Chestnut Ave",   "JOSE ZAMARRIPA": "CAUDI",
      "HERVEY QUINTERO": "West 12th St",            "LUPE JUAREZ": "Howard Ln",
      "IVAN MUNIZ": "Middle Fiskville SUP"
    },

    /* Gente que pide combustible y NO esta en la lista de mayordomos (del registro de POs). */
    USUARIOS_EXTRA: [
      "ABRAHAM GONZALES","ULISES LARA","JOSE ANTONIO LICEA","ISIDRO GARCIA","ENRIQUE CHAPA",
      "RAFAEL PEREZ","JOSE DE LA CERDA","JESUS G RODRIGUEZ","FRANCIS ECHEVESTRE","AVISAI JIMENEZ",
      "ROGELIO LOPEZ","ALEJANDRO ESQUIVEL","ANDY HERNANDEZ","MARTIN JUAREZ","JOSE GERARDO GARCIA",
      "MARCELA CASTANEDA","IVAN MUNIZ","FERNANDO ARELLANO","ALEXANDER ROSALES","URIEL SOTO",
      "BRYAN LOPEZ","JULIO MARTINEZ","PABLO REYNAGA"
    ],

    /* FLOTA. El tipo de combustible lo pone ESTE registro, no la persona.
       tipo: CAMIONETA (pide odometro) | MAQUINARIA (pide horas) | TAMBO (no pide lectura) | PIPA (camion de combustible)
       placa: dejarla "" hasta tenerla; mientras, la persona la dicta y queda MARCADO en el registro.
       Regla: mayordomos = camioneta DIESEL. supervisores = camioneta GASOLINA. gerentes = pipa. */
    FLOTA: [
      /* --- mayordomos: camioneta DIESEL --- */
      { id:"V-AAG", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"ALVARO AGUIRRE" },
      { id:"V-FAG", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"FRANCISCO AGUIRRE" },
      { id:"V-EAL", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"ENRIQUE ALVARADO" },
      { id:"V-FBO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"FRANCISCO BOCANEGRA" },
      { id:"V-RCA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"RUBEN CANO" },
      { id:"V-CDI", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"CARLOS DIAZ" },
      { id:"V-JGO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"JULIAN GONZALEZ" },
      { id:"V-OHE", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"OMAR ALFREDO HERNANDEZ" },
      { id:"V-PLI", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"PEDRO LIMON" },
      { id:"V-DMO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"DAVID MOLINA" },
      { id:"V-SNI", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"SERGIO NINO" },
      { id:"V-DOR", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"DANIEL ORTEGA" },
      { id:"V-JPE", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"JUAN PEREZ" },
      { id:"V-HQU", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"HERVEY QUINTERO" },
      { id:"V-GRO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"GIOVANNI RODRIGUEZ" },
      { id:"V-GSA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"GERARDO SANCHEZ" },
      { id:"V-ISA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"ISIDRO SANCHEZ" },
      { id:"V-RSA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"RICARDO SANCHEZ" },
      { id:"V-VSA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"VICTOR SANCHEZ" },
      { id:"V-DVA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"DIEGO VAZQUEZ" },
      { id:"V-JZA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"JOSE ZAMARRIPA" },
      { id:"V-IGA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"ISIDRO GARCIA" },
      { id:"V-IMU", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"IVAN MUNIZ" },
      /* --- supervisores: camioneta GASOLINA --- */
      { id:"V-MJU", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"MIGUEL JUAREZ" },
      { id:"V-THE", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"TACHO HERNANDEZ" },
      { id:"V-JLZ", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"JOSE LUIS ZAMARRIPA" },
      { id:"V-MGO", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"MARTIN GONZALEZ" },
      { id:"V-LJU", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL",   de:"LUPE JUAREZ" },   /* supervisor, pero su camioneta es diésel */
      /* --- gerentes de proyecto: TODOS traen camioneta de GASOLINA --- */
      { id:"P-HMA", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"HECTOR MANZANARES" },
      { id:"P-SMA", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"SIMON MARTINEZ" },
      { id:"P-MMU", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"MARIO MUNOZ" },
      { id:"P-HCA", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"HUGO CARLINO" },
      { id:"P-EVA", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"EDUARDO VALENZUELA" },
      { id:"P-LPE", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"LUIS PEREZ" },
      /* --- choferes y otros (revisar tipo de combustible) --- */
      { id:"V-HSE", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"HECTOR SEGURA" },
      { id:"V-AGO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"ABRAHAM GONZALES" },
      { id:"V-ULA", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"ULISES LARA" },
      { id:"V-ECH", placa:"", desc:"Camioneta gasolina", tipo:"CAMIONETA", comb:"GASOLINA", de:"ENRIQUE CHAPA" },   /* coordinador de operaciones */
      { id:"V-RPE", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"RAFAEL PEREZ" },
      { id:"V-JRO", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"JESUS G RODRIGUEZ" },
      { id:"V-AJI", placa:"", desc:"Camioneta diésel", tipo:"CAMIONETA", comb:"DIESEL", de:"AVISAI JIMENEZ" },
      /* --- camiones (dump trucks): la tabla vehicles los tiene como D-####. Los choferes
             escriben la placa; si la tabla tiene esa placa en la fila D-####, el PO cae ahi. --- */
      /* --- equipo compartido: cualquiera puede escogerlo, pide numero de equipo --- */
      { id:"M-GEN", placa:"", desc:"Maquinaria (bobcat, rodillo, compactador, generador…)", tipo:"MAQUINARIA", comb:"DIESEL",   de:"" },
      { id:"T-DSL", placa:"", desc:"Tambo / tanque de DIÉSEL",   tipo:"TAMBO", comb:"DIESEL",   de:"" },
      { id:"T-GAS", placa:"", desc:"Tambo / tanque de GASOLINA", tipo:"TAMBO", comb:"GASOLINA", de:"" },
    ],

    /* Alertas. La oficina las ve; el app avisa en el momento. */
    ALERTAS: { HORAS_MIN_ENTRE_CARGAS: 6, CARGAS_MAX_7DIAS: 4, MILLAS_MIN_ENTRE_CARGAS: 40 },
  },

  /* (compatibilidad con la version anterior - ya no se usa si OFICINA existe) */
  MASTER_USER: "TITO CUETO",
  OFFICE_PIN:  "4605",

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
  /* ===== CHOFERES (recogen material para un mayordomo) =====
     El pedido se sigue registrando al MAYORDOMO; el chofer solo lo recoge.
     Agrega o quita choferes aqui. Si se deja vacio {}, el boton
     "SOY CHOFER" no aparece en el app. */
  CHOFERES: {
    "HECTOR SEGURA": "",
  },

  /* Telefonos de los mayordomos (para avisarles aprobado / no autorizado) */
  MAYORDOMOS: {}
};
