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
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

async function calcularHashReal(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ruta de comprobación de salud para Render (evita el 404 en la raíz)
app.get('/', (req, res) => {
    res.status(200).json({ estado: "OK", servicio: "Vertex Axioma Backend Activo" });
});

// Fallback en caso de que RPC_URL aún no esté definido en Render
const RPC_URL = process.env.RPC_URL || "https://rpc-amoy.polygon.technology";
const provider = new ethers.JsonRpcProvider(RPC_URL);

let isProcessing = false; 
const filaTransacciones = [];
let historialEvidencia = [];

// Constantes de almacenamiento
const VIDEO_PATH = path.join(__dirname, 'auditoria_activa.mp4');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

app.post('/api/v2/iniciar-nueva-sesion', (req, res) => {
    cadenaDeHash = [];

    if (fs.existsSync(MANIFEST_PATH)) {
        fs.unlinkSync(MANIFEST_PATH);
    }

    if (fs.existsSync(VIDEO_PATH)) {
        fs.unlinkSync(VIDEO_PATH);
    }

    fs.writeFileSync('manifest.json', JSON.stringify([], null, 2)); 
    res.json({ mensaje: "Sesión limpia: Manifiesto borrado y reiniciado." });
});

app.post('/api/v2/petrificar-fragmento', async (req, res) => {
    const { data, hash } = req.body;
    try {
        fs.appendFileSync('video.mp4', Buffer.from(data, 'base64')); 
        
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hash)
        });

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
            selloBlockchain: ultimaTx,
            nodo: "Vertex Axioma"
        };
        
        fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hashFinal)
        });

        historialEvidencia = []; 
        
        console.log("[📁] manifest.json generado. Sello aplicado en:", tx.hash);
        return res.status(200).json({ status: "OK", tx: tx.hash, manifest });
    } catch (error) {
        console.error("[❌] ERROR CRÍTICO EN SERVIDOR:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/v2/ingestar-lote', upload.array('files'), async (req, res) => {
    try {
        if (req.headers['x-axioma-key'] !== process.env.ACCESO_KEY) throw new Error("VIOLACIÓN: Clave inválida.");

        const metaSoftware = JSON.parse(req.headers['x-axioma-metadata-software'] || '{}');
        const metaHardware = JSON.parse(req.headers['x-axioma-metadata-hardware'] || '{}');

        if (!req.files || req.files.length === 0) throw new Error("No se recibieron archivos.");

        const resultados = req.files.map(file => ({
            nombre: file.originalname,
            hash_petrificado: crypto.createHash('sha256').update(file.buffer).digest('hex'),
            tamano: file.size
        }));

        const hashSoftware = crypto.createHash('sha256').update(JSON.stringify(metaSoftware)).digest('hex');
        const hashHardware = crypto.createHash('sha256').update(JSON.stringify(metaHardware)).digest('hex');
        
        const payloadAtomizado = JSON.stringify({
            data: resultados,
            software: hashSoftware,
            hardware: hashHardware,
            timestamp: new Date().toISOString()
        });
        
        const metaHashFinal = crypto.createHash('sha256').update(payloadAtomizado).digest('hex');

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

app.post('/api/v2/ingestar-fragmento', async (req, res) => {
    const { hash, data } = req.body;

    if (isProcessing) {
        return res.status(429).json({ error: "Nodo ocupado." });
    }

    isProcessing = true;

    try {
        const buffer = Buffer.from(data, 'base64');
        const hashCalculado = crypto.createHash('sha256').update(buffer).digest('hex');
        
        fs.appendFileSync(VIDEO_PATH, buffer);

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + hashCalculado),
            nonce: await provider.getTransactionCount(wallet.address, 'pending')
        });

        await tx.wait();

        let manifest = [];
        if (fs.existsSync(MANIFEST_PATH)) {
            try {
                const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
                if (content) manifest = JSON.parse(content);
            } catch (e) { manifest = []; }
        }

        manifest.push({
            data_hash: hashCalculado,
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
        isProcessing = false;
    }
});

app.post('/api/v2/petrificar-adn-digital', async (req, res) => {
    try {
        const { rootHash, metaHash, droneId, timestamp } = req.body;
        
        const dnaDigital = crypto.createHash('sha256').update((rootHash || '') + (metaHash || '')).digest('hex'); 
        
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

app.post('/api/v2/finalizar-auditoria', async (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) throw new Error("No hay manifiesto para cerrar.");
        
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        
        const todosLosHashes = manifest.map(item => item.data_hash).join('');
        const rootHash = crypto.createHash('sha256').update(todosLosHashes).digest('hex');
        
        const metaData = { timestamp: new Date().toISOString(), total_fragmentos: manifest.length };
        const metaHash = crypto.createHash('sha256').update(JSON.stringify(metaData)).digest('hex');
        
        const dnaDigital = crypto.createHash('sha256').update(rootHash + metaHash).digest('hex');
        
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        
        const tx = await wallet.sendTransaction({
            to: wallet.address,
            data: ethers.getBytes("0x" + dnaDigital),
            nonce: nonce
        });

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

app.get('/download-auditoria', (req, res) => {
    if (fs.existsSync(VIDEO_PATH)) res.download(VIDEO_PATH, 'Auditoria_Vertex_Axioma.mp4');
    else res.status(404).send("Archivo no encontrado.");
});

app.get('/api/v2/generar-certificado', async (req, res) => {
    const { tx, dna } = req.query;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Certificado_Axioma_${tx ? tx.substring(0,6) : 'doc'}.pdf`);

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

// ESCUCHA EN EL PUERTO DINÁMICO DE RENDER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Vertex Axioma activo en puerto ${PORT}`));
