const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configurar multer para upload de imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static('uploads'));

// Inicializar banco de dados SQLite
const db = new sqlite3.Database('./denuncias.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err);
    } else {
        console.log('Conectado ao banco de dados SQLite');
        inicializarBanco();
    }
});

function inicializarBanco() {
    db.run(`
        CREATE TABLE IF NOT EXISTS denuncias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocolo TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL,
            endereco TEXT NOT NULL,
            descricao TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pendente',
            autorHash TEXT NOT NULL,
            autorCpf TEXT NOT NULL,
            data TEXT NOT NULL,
            imagem BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela:', err);
        else console.log('Tabela de denúncias pronta');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            nome TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela de admins:', err);
        else {
            console.log('Tabela de admins pronta');
            // Inserir admins padrão se não existirem
            inserirAdminsPadrão();
        }
    });
}

function inserirAdminsPadrão() {
    db.run(`INSERT OR IGNORE INTO admins (usuario, senha, nome) VALUES (?, ?, ?)`, 
        ['admin', 'admin', 'Fiscal Operacional'], (err) => {
            if (err) console.error('Erro ao inserir admin:', err);
        }
    );
    db.run(`INSERT OR IGNORE INTO admins (usuario, senha, nome) VALUES (?, ?, ?)`, 
        ['admin123', 'admin123', 'Fiscal Operacional'], (err) => {
            if (err) console.error('Erro ao inserir admin:', err);
        }
    );
}

// Rotas

// GET - Teste de conexão
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// POST - Criar nova denúncia
app.get('/api/denuncias', (req, res) => {
    db.all('SELECT * FROM denuncias ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

// GET - Buscar denúncias de um cidadão específico (por CPF hash)
app.get('/api/denuncias/:cpf', (req, res) => {
    const cpf = req.params.cpf;
    db.all('SELECT * FROM denuncias WHERE autorCpf = ? ORDER BY created_at DESC', [cpf], (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

// POST - Criar nova denúncia
app.post('/api/denuncias', (req, res) => {
    const { protocolo, tipo, endereco, descricao, lat, lng, autorHash, autorCpf, data, imagem } = req.body;

    console.log('Recebendo denúncia:', protocolo);
    console.log('Tem imagem?', !!imagem);

    if (!protocolo || !tipo || !endereco || !descricao || !lat || !lng || !autorHash || !autorCpf) {
        return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    }

    const sql = `
        INSERT INTO denuncias (protocolo, tipo, endereco, descricao, lat, lng, autorHash, autorCpf, data, imagem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [protocolo, tipo, endereco, descricao, lat, lng, autorHash, autorCpf, data, imagem || null], function(err) {
        if (err) {
            console.error('Erro ao inserir denúncia:', err);
            res.status(500).json({ erro: err.message });
        } else {
            console.log('Denúncia criada com sucesso:', protocolo);
            res.json({ id: this.lastID, protocolo, status: 'Pendente' });
        }
    });
});

// PUT - Atualizar status da denúncia
app.put('/api/denuncias/:protocolo', (req, res) => {
    const { status } = req.body;
    const protocolo = req.params.protocolo;

    if (!status) {
        return res.status(400).json({ erro: 'Status é obrigatório' });
    }

    db.run('UPDATE denuncias SET status = ? WHERE protocolo = ?', [status, protocolo], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else if (this.changes === 0) {
            res.status(404).json({ erro: 'Denúncia não encontrada' });
        } else {
            res.json({ success: true, protocolo, status });
        }
    });
});

// DELETE - Remover denúncia
app.delete('/api/denuncias/:protocolo', (req, res) => {
    const protocolo = req.params.protocolo;

    db.run('DELETE FROM denuncias WHERE protocolo = ?', [protocolo], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else if (this.changes === 0) {
            res.status(404).json({ erro: 'Denúncia não encontrada' });
        } else {
            res.json({ success: true, protocolo });
        }
    });
});

// POST - Login admin
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
    }

    db.get('SELECT * FROM admins WHERE usuario = ? AND senha = ?', [usuario, senha], (err, row) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else if (row) {
            res.json({ success: true, nome: row.nome, role: 'admin' });
        } else {
            res.status(401).json({ erro: 'Credenciais inválidas' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
