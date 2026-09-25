require('dotenv').config();
global.window = global;

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const ethers = require('ethers');
const multer = require('multer');
const upload = multer();
const fs = require('fs');
const path = require('path');

async function calcularHashReal(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

let isProcessing = false; 
const filaTransacciones = [];

// Constantes de almacenamiento
const VIDEO_PATH = path.join(__dirname, 'auditoria_activa.mp4');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// --- RUTA 1: Petrificación Simple (Mesa de Entrada) ---
// ¡IMPORTANTE! Asegurate de declarar esto ANTES de la ruta (fuera de la función)
// let isProcessing = false; 

// En tu vertex_api.js, agregá este endpoint simple para limpiar antes de empezar
	app.post('/api/v2/iniciar-nueva-sesion', (req, res) => {
	   cadenaDeHash = [];

	// ELIMINA EL ARCHIVO FÍSICO
	    if (fs.existsSync(MANIFEST_PATH)) {
	        fs.unlinkSync(MANIFEST_PATH);
	    }

	// ELIMINA EL VIDEO VIEJO (Opcional, pero recomendado)
	    if (fs.existsSync(VIDEO_PATH)) {
	        fs.unlinkSync(VIDEO_PATH);
	    }

	   fs.writeFileSync('manifest.json', JSON.stringify([], null, 2)); 
   	   res.json({ mensaje: "Sesión limpia: Manifiesto borrado y reiniciado." });
        });
// =================================================================
// 1. MESA DE ENTRADA: Recibe fragmentos y construye el video (.mp4)
// =================================================================
// ELIMINA la variable isProcessing y el chequeo en la ruta

let historialEvidencia = [];

app.post('/api/v2/petrificar-fragmento', async (req, res) => {
    const { data, hash } = req.body;
    try {
        fs.appendFileSync('video.mp4', Buffer.from(data, 'base64')); 
        
        // Petrificación directa en cada fragmento
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hash)
        });


// ACUMULACIÓN DE EVIDENCIA (Ahora persistente)
        historialEvidencia.push({
            hash: hash,
            tx: tx.hash,
            timestamp: new Date().toISOString()
        });

        console.log(`[🔗] Fragmento petrificado en TX: ${tx.hash}`);
        return res.status(200).json({ status: "OK", tx: tx.hash });
    } catch (error) {
        return res.status(500).json({ error: "Fallo en petrificación" });
    }
});
// =================================================================
// 2. CIERRE DE AUDITORÍA: Genera el manifest.json y sella todo
// =================================================================

app.post('/api/v2/finalizar-y-petrificar', async (req, res) => {
    try {
        
	const videoBuffer = fs.readFileSync('video.mp4');
        const hashFinal = await calcularHashReal(videoBuffer);

	const ultimaTx = historialEvidencia.length > 0 
            ? historialEvidencia[historialEvidencia.length - 1].tx 
            : "SIN_TX_REGISTRADA";
        
        const manifest = {
            hashFinal: hashFinal,
            cadenaDeCustodia: historialEvidencia,
            fecha: new Date().toISOString(),
            selloBlockchain: ultimaTx, // Aquí queda el TC/TX de la Blockchain
            nodo: "Vertex Axioma"
        };
        
        // Escribimos el JSON real, reemplazando el archivo vacío
        fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
        console.log("[📁] manifest.json generado exitosamente.");

        // Ejecutamos el Sello de Inmutabilidad Transfronteriza en la Blockchain
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hashFinal)
        });


// RESET IMPORTANTE:
       historialEvidencia = []; 
        
        console.log("[📁] manifest.json generado. Sello aplicado en:", tx.hash);
        return res.status(200).json({ status: "OK", tx: tx.hash, manifest });
    } catch (error) {
        console.error("[❌] ERROR CRÍTICO EN SERVIDOR:", error.message); // <--- ESTO ES LO QUE DEBES VER EN LA TERMINAL
        return res.status(500).json({ error: error.message });
    }
});


// --- RUTA 2: Ingesta de Lote (Auditoría 4.0 / Atomización) ---
app.post('/api/v2/ingestar-lote', upload.array('files'), async (req, res) => {
    try {
        // 1. Validación de Seguridad
        if (req.headers['x-axioma-key'] !== process.env.ACCESO_KEY) throw new Error("VIOLACIÓN: Clave inválida.");

        // 2. Metadatos
        const metaSoftware = JSON.parse(req.headers['x-axioma-metadata-software'] || '{}');
        const metaHardware = JSON.parse(req.headers['x-axioma-metadata-hardware'] || '{}');

        // 3. Procesamiento
        if (!req.files || req.files.length === 0) throw new Error("No se recibieron archivos.");

        const resultados = req.files.map(file => ({
            nombre: file.originalname,
            hash_petrificado: crypto.createHash('sha256').update(file.buffer).digest('hex'),
            tamano: file.size
        }));

        // 4. Atomización
        const hashSoftware = crypto.createHash('sha256').update(JSON.stringify(metaSoftware)).digest('hex');
        const hashHardware = crypto.createHash('sha256').update(JSON.stringify(metaHardware)).digest('hex');
        
        const payloadAtomizado = JSON.stringify({
            data: resultados,
            software: hashSoftware,
            hardware: hashHardware,
            timestamp: new Date().toISOString()
        });
        
        const metaHashFinal = crypto.createHash('sha256').update(payloadAtomizado).digest('hex');

        // 5. Blockchain
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + metaHashFinal),
            nonce: nonce
        });

        const receipt = await tx.wait();

        res.status(200).json({ 
            estado: "EXITO", 
            tx: tx.hash, 
            bloque: receipt.blockNumber,
            auditoria: { meta_hash: metaHashFinal, hash_software: hashSoftware, hash_hardware: hashHardware },
            detalle: resultados 
        });

    } catch (error) {
        res.status(400).json({ estado: "ERROR", motivo: error.message });
    }
});

// --- RUTA 3: Ingesta de Fragmento (Agente Vertex / Video) ---

app.post('/api/v2/ingestar-fragmento', async (req, res) => {
const { hash, data } = req.body;// Ya no necesitamos el hash del cliente

if (isProcessing) {
        return res.status(429).json({ error: "Nodo ocupado." });
    }

isProcessing = true; // Candado cerrado

    try {
        const buffer = Buffer.from(data, 'base64');

// --- AQUÍ OCURRE LA MAGIA FORENSE ---
        // Calculamos el hash del binario REAL que vamos a escribir
        const hashCalculado = crypto.createHash('sha256').update(buffer).digest('hex');
        
        fs.appendFileSync(VIDEO_PATH, buffer);

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
	 const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hashCalculado), // Usamos nuestro hash calculado
            nonce: await provider.getTransactionCount(wallet.address, 'pending')
        });

        await tx.wait();

        // Actualizar Manifiesto
        let manifest = [];
        if (fs.existsSync(MANIFEST_PATH)) {
            try {
                const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
                if (content) manifest = JSON.parse(content);
            } catch (e) { manifest = []; }
        }

        manifest.push({
           data_hash: hashCalculado, // Guardamos el hash calculado por el servidor
            tx_hash: tx.hash,
	    size: buffer.length,
            timestamp: new Date().toISOString()
        });

        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

        res.status(200).json({ status: "OK", tx: tx.hash });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO:", error);
        res.status(500).json({ error: "Fallo en la petrificación." });
    } finally {
	isProcessing = false; // SIEMPRE liberar el candado
    }

});

// --- RUTA: FINALIZAR Y PETRIFICAR ---
app.post('/api/v2/finalizar-y-petrificar', async (req, res) => {
    try {
        // Cálculo del hash final del archivo completo consolidado
        const videoBuffer = fs.readFileSync('video.mp4');
        const hashFinal = await calcularHashReal(videoBuffer); // Asegúrate de tener esta función en el backend

        const manifest = {
            hashFinal: hashFinal,
            cadenaDeCustodia: historialEvidencia, // Aquí está todo el ADN acumulado
            fecha: new Date().toISOString(),
            estado: "EVIDENCIA_PETRIFICADA",
            nodo: "Vertex Axioma"
        };

        fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
        
        // Limpiamos para la próxima sesión
        historialEvidencia = []; 

        console.log("[📜] Auditoría finalizada. Manifiesto generado.");
        return res.status(200).json({ status: "OK", tx: "Finalizado", manifest });
    } catch (error) {
        return res.status(500).json({ error: "Error al consolidar manifiesto" });
    }
});

// HASH Raíz (Corregido y vinculado a la wallet)
app.post('/api/v2/petrificar-adn-digital', async (req, res) => {
    try {
        const { rootHash, metaHash, droneId, timestamp } = req.body;
        
        // 1. Unificamos hashes con crypto
        const dnaDigital = crypto.createHash('sha256').update((rootHash || '') + (metaHash || '')).digest('hex'); 
        
        // 2. Transacción en Blockchain con ethers
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + dnaDigital)
        });

        console.log(`[🔎] ADN Digital final registrado: ${dnaDigital}`);
        return res.json({ estado: "PETRIFICADO", dna: dnaDigital, tx: tx.hash });

    } catch (error) {
        console.error("❌ Error en petrificar-adn-digital:", error.message);
        return res.status(500).json({ estado: "ERROR", motivo: error.message });
    }
});

// --- NUEVO: Cierre de Auditoría (Generación de ADN Digital) ---
app.post('/api/v2/finalizar-auditoria', async (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) throw new Error("No hay manifiesto para cerrar.");
        
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        
        // 1. Calcular Hash Raíz (Root Hash) de todos los fragmentos
        const todosLosHashes = manifest.map(item => item.data_hash).join('');
        const rootHash = crypto.createHash('sha256').update(todosLosHashes).digest('hex');
        
        // 2. Generar Meta Hash
        const metaData = { timestamp: new Date().toISOString(), total_fragmentos: manifest.length };
        const metaHash = crypto.createHash('sha256').update(JSON.stringify(metaData)).digest('hex');
        
        // 3. DNA Digital
        const dnaDigital = crypto.createHash('sha256').update(rootHash + metaHash).digest('hex');
        
        // 4. Petrificar en Blockchain
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + dnaDigital),
            nonce: nonce
        });

        console.log(`[🔗] ADN DIGITAL PETRIFICADO: ${dnaDigital}`);
        console.log(`[🚀] TX: ${tx.hash}`);

        res.status(200).json({ 
            estado: "ADN_PETRIFICADO", 
            dna: dnaDigital, 
            tx: tx.hash,
            resumen: "Auditoría cerrada correctamente" 
        });

    } catch (error) {
        res.status(500).json({ estado: "ERROR", motivo: error.message });
    }
});

// --- RUTA: Descarga video ---
app.get('/download-auditoria', (req, res) => {
    if (fs.existsSync(VIDEO_PATH)) res.download(VIDEO_PATH, 'Auditoria_Vertex_Axioma.mp4');
    else res.status(404).send("Archivo no encontrado.");
});

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

app.get('/api/v2/generar-certificado', async (req, res) => {
    const { tx, dna } = req.query;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Certificado_Axioma_${tx.substring(0,6)}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('Certificado de Existencia de Activos 4.0', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Sello de Conformidad Fiscal 4.0`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).text(`Transacción Blockchain: ${tx}`);
    doc.text(`ADN Digital (Hash Raíz + Meta Hash):`);
    doc.fontSize(8).text(dna);
    doc.moveDown();

    const qrBuffer = await QRCode.toBuffer(`https://amoy.polygonscan.com/tx/${tx}`);
    doc.image(qrBuffer, { fit: [150, 150], align: 'center' });
    doc.text('Escanear para verificar en Blockchain', { align: 'center' });

    doc.end();
});

app.listen(3000, () => console.log('🚀 Vertex Axioma activo. Puerto: 3000'));