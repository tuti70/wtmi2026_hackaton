const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const nodemailer = require('nodemailer');
const { promisify } = require('util');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEMO_SESSION_TTL_MS = 30 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_RESEND_DELAY_MS = 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const MAX_EMAIL_CODE_ATTEMPTS = 5;
const demoSessions = new Map();
const citizenSessions = new Map();
const emailChallenges = new Map();
const verifiedEmails = new Map();
const emailSendCooldowns = new Map();
const smtpPort = Number(process.env.SMTP_PORT);
const smtpConfigured = Boolean(process.env.SMTP_HOST && smtpPort && process.env.SMTP_FROM);
const emailTransporter = smtpConfigured
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: smtpPort,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined
    })
    : null;
const scryptAsync = promisify(crypto.scrypt);
const citizenSessionTtlMs = 12 * 60 * 60 * 1000;
const cpfHashKeyPath = process.env.CPF_HASH_KEY_PATH
    || path.join(os.homedir(), '.zerofoco', 'cpf-hash.key');
let cpfHashKey;

function carregarChaveHashCpf() {
    fs.mkdirSync(path.dirname(cpfHashKeyPath), { recursive: true });
    try {
        cpfHashKey = fs.readFileSync(cpfHashKeyPath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const novaChave = crypto.randomBytes(32);
        try {
            fs.writeFileSync(cpfHashKeyPath, novaChave, { flag: 'wx', mode: 0o600 });
            cpfHashKey = novaChave;
        } catch (writeError) {
            if (writeError.code !== 'EEXIST') throw writeError;
            cpfHashKey = fs.readFileSync(cpfHashKeyPath);
        }
    }
    if (cpfHashKey.length !== 32) {
        throw new Error('A chave de proteção de CPF deve conter exatamente 32 bytes.');
    }
}

carregarChaveHashCpf();

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
            triage_note TEXT NOT NULL DEFAULT '',
            recovery_key_hash TEXT,
            data TEXT NOT NULL,
            imagem BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela:', err);
        else {
            db.all('PRAGMA table_info(denuncias)', (schemaError, columns) => {
                if (schemaError) {
                    console.error('Erro ao verificar estrutura da tabela de denúncias:', schemaError);
                    return;
                }
                const migrations = [
                    {
                        column: 'triage_note',
                        sql: "ALTER TABLE denuncias ADD COLUMN triage_note TEXT NOT NULL DEFAULT ''",
                        errorMessage: 'Erro ao adicionar nota de triagem:'
                    },
                    {
                        column: 'recovery_key_hash',
                        sql: 'ALTER TABLE denuncias ADD COLUMN recovery_key_hash TEXT',
                        errorMessage: 'Erro ao adicionar chave de recuperação:'
                    },
                    {
                        column: 'citizen_account_id',
                        sql: 'ALTER TABLE denuncias ADD COLUMN citizen_account_id INTEGER',
                        errorMessage: 'Erro ao adicionar vínculo de conta cidadã:'
                    }
                ].filter(migration => !columns.some(column => column.name === migration.column));

                const runMigration = index => {
                    if (index === migrations.length) {
                        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_denuncias_recovery_key_hash ON denuncias (recovery_key_hash) WHERE recovery_key_hash IS NOT NULL', indexError => {
                            if (indexError) console.error('Erro ao criar índice da chave de recuperação:', indexError);
                            else console.log('Tabela de denúncias pronta');
                        });
                        return;
                    }

                    const migration = migrations[index];
                    db.run(migration.sql, migrationError => {
                        if (migrationError) {
                            console.error(migration.errorMessage, migrationError);
                            return;
                        }
                        runMigration(index + 1);
                    });
                };

                runMigration(0);
            });
        }
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

    db.run(`
        CREATE TABLE IF NOT EXISTS citizen_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cpf_hash TEXT UNIQUE NOT NULL,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, err => {
        if (err) console.error('Erro ao criar tabela de contas cidadãs:', err);
        else console.log('Tabela de contas cidadãs pronta');
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

// POST - Criar sessão fictícia para demonstrar a futura integração de identidade
app.post('/api/demo-auth', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const identity = {
        id: 'DEMO-CITIZEN-001',
        label: 'Pessoa demonstrativa'
    };

    demoSessions.set(token, {
        ...identity,
        expiresAt: Date.now() + DEMO_SESSION_TTL_MS
    });

    res.json({
        token,
        label: identity.label,
        simulated: true,
        expiresInSeconds: DEMO_SESSION_TTL_MS / 1000
    });
});

function normalizarCpf(cpf) {
    return typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
}

function cpfComDigitosValidos(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const calcularDigito = tamanho => {
        let soma = 0;
        for (let indice = 0; indice < tamanho; indice++) {
            soma += Number(cpf[indice]) * (tamanho + 1 - indice);
        }
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    return calcularDigito(9) === Number(cpf[9])
        && calcularDigito(10) === Number(cpf[10]);
}

function gerarHashCpf(cpf) {
    return crypto.createHmac('sha256', cpfHashKey).update(cpf).digest('hex');
}

function obterSessaoCidadao(req) {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    const session = citizenSessions.get(match[1]);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        citizenSessions.delete(match[1]);
        return null;
    }
    return session;
}

function criarSessaoCidadao(accountId) {
    const token = crypto.randomBytes(32).toString('hex');
    citizenSessions.set(token, {
        accountId,
        expiresAt: Date.now() + citizenSessionTtlMs
    });
    return token;
}

function responderComSessaoCidadao(res, accountId) {
    res.json({
        token: criarSessaoCidadao(accountId),
        expiresInSeconds: citizenSessionTtlMs / 1000
    });
}

app.post('/api/backup/cidadao/cadastro', async (req, res) => {
    const cpf = normalizarCpf(req.body.cpf);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!cpfComDigitosValidos(cpf)) {
        return res.status(400).json({ erro: 'Informe um CPF válido.' });
    }
    if (senha.length < 8 || senha.length > 128) {
        return res.status(400).json({ erro: 'A senha deve ter entre 8 e 128 caracteres.' });
    }

    const salt = crypto.randomBytes(16);
    try {
        const passwordHash = await scryptAsync(senha, salt, 64);
        db.run(
            'INSERT INTO citizen_accounts (cpf_hash, password_salt, password_hash) VALUES (?, ?, ?)',
            [gerarHashCpf(cpf), salt.toString('hex'), passwordHash.toString('hex')],
            function (error) {
                if (error && error.code === 'SQLITE_CONSTRAINT') {
                    return res.status(409).json({ erro: 'Já existe uma conta para este CPF. Entre com sua senha.' });
                }
                if (error) {
                    console.error('Erro ao criar conta cidadã:', error);
                    return res.status(500).json({ erro: 'Não foi possível criar a conta.' });
                }
                responderComSessaoCidadao(res, this.lastID);
            }
        );
    } catch (error) {
        console.error('Erro ao proteger credenciais da conta cidadã:', error);
        res.status(500).json({ erro: 'Não foi possível criar a conta.' });
    }
});

app.post('/api/backup/cidadao/entrar', async (req, res) => {
    const cpf = normalizarCpf(req.body.cpf);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!cpfComDigitosValidos(cpf) || !senha) {
        return res.status(400).json({ erro: 'Informe um CPF válido e sua senha.' });
    }

    db.get(
        'SELECT id, password_salt, password_hash FROM citizen_accounts WHERE cpf_hash = ?',
        [gerarHashCpf(cpf)],
        async (error, account) => {
            if (error) {
                console.error('Erro ao consultar conta cidadã:', error);
                return res.status(500).json({ erro: 'Não foi possível entrar na conta.' });
            }
            if (!account) return res.status(401).json({ erro: 'CPF ou senha inválidos.' });

            try {
                const candidate = await scryptAsync(senha, Buffer.from(account.password_salt, 'hex'), 64);
                const expected = Buffer.from(account.password_hash, 'hex');
                if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
                    return res.status(401).json({ erro: 'CPF ou senha inválidos.' });
                }
                responderComSessaoCidadao(res, account.id);
            } catch (hashError) {
                console.error('Erro ao verificar senha da conta cidadã:', hashError);
                res.status(500).json({ erro: 'Não foi possível entrar na conta.' });
            }
        }
    );
});

app.post('/api/backup/cidadao/sair', (req, res) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) citizenSessions.delete(match[1]);
    res.json({ success: true });
});

app.get('/api/backup/cidadao/denuncias', (req, res) => {
    const session = obterSessaoCidadao(req);
    if (!session) return res.status(401).json({ erro: 'Entre novamente para ver suas denúncias.' });

    db.all(
        'SELECT protocolo, tipo, endereco, status, data, created_at FROM denuncias WHERE citizen_account_id = ? ORDER BY created_at DESC',
        [session.accountId],
        (error, rows) => {
            if (error) {
                console.error('Erro ao consultar denúncias da conta cidadã:', error);
                return res.status(500).json({ erro: 'Não foi possível carregar suas denúncias.' });
            }
            res.json(rows);
        }
    );
});

function obterTokenDemonstrativo(req) {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
    return match ? match[1] : null;
}

function obterSessaoDemonstrativa(req) {
    const token = obterTokenDemonstrativo(req);
    if (!token) return null;

    const session = demoSessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        demoSessions.delete(token);
        return null;
    }
    return session;
}

app.post('/api/demo-logout', (req, res) => {
    const token = obterTokenDemonstrativo(req);
    if (token) demoSessions.delete(token);
    res.json({ success: true });
});

function normalizarEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function emailValido(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function limparDadosVerificacaoEmail() {
    const now = Date.now();
    for (const [id, challenge] of emailChallenges) {
        if (challenge.expiresAt <= now) emailChallenges.delete(id);
    }
    for (const [token, verification] of verifiedEmails) {
        if (verification.expiresAt <= now || verification.consumed) verifiedEmails.delete(token);
    }
    for (const [emailHash, sentAt] of emailSendCooldowns) {
        if (now - sentAt >= EMAIL_CODE_RESEND_DELAY_MS) emailSendCooldowns.delete(emailHash);
    }
}

app.post('/api/email/codigo', async (req, res) => {
    const email = normalizarEmail(req.body.email);
    if (!emailValido(email)) {
        return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (!emailTransporter) {
        return res.status(503).json({ erro: 'O envio de e-mails ainda não foi configurado. Tente novamente mais tarde ou continue sem informar e-mail.' });
    }

    limparDadosVerificacaoEmail();
    const emailHash = crypto.createHash('sha256').update(email).digest('hex');
    const lastSentAt = emailSendCooldowns.get(emailHash);
    if (lastSentAt && Date.now() - lastSentAt < EMAIL_CODE_RESEND_DELAY_MS) {
        return res.status(429).json({ erro: 'Aguarde um minuto antes de solicitar outro código.' });
    }

    const codigo = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challengeId = crypto.randomBytes(24).toString('hex');
    const codigoHash = crypto.createHash('sha256').update(`${challengeId}:${codigo}`).digest('hex');

    try {
        await emailTransporter.sendMail({
            from: process.env.SMTP_FROM,
            to: email,
            subject: 'Confirme seu e-mail para a denúncia — ZeroFoco',
            text: `Seu código de confirmação do ZeroFoco é: ${codigo}\n\nEle expira em 10 minutos. Se você não solicitou este código, ignore esta mensagem.`
        });
    } catch (error) {
        console.error('Erro ao enviar código de verificação por e-mail:', error.code || error.name || 'erro SMTP');
        return res.status(502).json({ erro: 'Não foi possível enviar o código. Confira o endereço ou tente novamente mais tarde.' });
    }

    emailSendCooldowns.set(emailHash, Date.now());
    emailChallenges.set(challengeId, {
        email,
        codigoHash,
        expiresAt: Date.now() + EMAIL_CODE_TTL_MS,
        attempts: 0
    });
    res.json({ challengeId, expiresInSeconds: EMAIL_CODE_TTL_MS / 1000 });
});

app.post('/api/email/verificar', (req, res) => {
    limparDadosVerificacaoEmail();
    const challengeId = typeof req.body.challengeId === 'string' ? req.body.challengeId : '';
    const codigo = typeof req.body.codigo === 'string' ? req.body.codigo.trim() : '';
    const challenge = emailChallenges.get(challengeId);

    if (!challenge || challenge.expiresAt <= Date.now()) {
        emailChallenges.delete(challengeId);
        return res.status(400).json({ erro: 'O código expirou ou não foi encontrado. Solicite um novo código.' });
    }
    if (!/^\d{6}$/.test(codigo)) {
        challenge.attempts += 1;
        if (challenge.attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
            emailChallenges.delete(challengeId);
        }
        return res.status(400).json({ erro: 'Digite o código de 6 números enviado para seu e-mail.' });
    }

    const codigoHash = crypto.createHash('sha256').update(`${challengeId}:${codigo}`).digest();
    const hashEsperado = Buffer.from(challenge.codigoHash, 'hex');
    if (!crypto.timingSafeEqual(codigoHash, hashEsperado)) {
        challenge.attempts += 1;
        if (challenge.attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
            emailChallenges.delete(challengeId);
            return res.status(400).json({ erro: 'Limite de tentativas atingido. Solicite um novo código.' });
        }
        return res.status(400).json({ erro: 'Código incorreto. Confira o e-mail e tente novamente.' });
    }

    emailChallenges.delete(challengeId);
    const token = crypto.randomBytes(32).toString('hex');
    verifiedEmails.set(token, {
        email: challenge.email,
        expiresAt: Date.now() + EMAIL_VERIFICATION_TTL_MS,
        consumed: false
    });
    res.json({ token });
});

// POST - Criar nova denúncia
app.get('/api/denuncias', (req, res) => {
    db.all('SELECT id, protocolo, tipo, endereco, descricao, lat, lng, status, autorHash, triage_note, data, imagem, created_at FROM denuncias ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.post('/api/denuncias/recuperar', (req, res) => {
    const chave = typeof req.body.chave === 'string' ? req.body.chave.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(chave)) {
        return res.status(400).json({ erro: 'Informe uma chave de recuperação válida.' });
    }

    const chaveHash = crypto.createHash('sha256').update(chave).digest('hex');
    db.get('SELECT protocolo, status, data FROM denuncias WHERE recovery_key_hash = ?', [chaveHash], (err, row) => {
        if (err) {
            res.status(500).json({ erro: 'Não foi possível recuperar o protocolo.' });
        } else if (!row) {
            res.status(404).json({ erro: 'Chave não encontrada. Confira se copiou a chave de recuperação completa.' });
        } else {
            res.json(row);
        }
    });
});

// GET - Consultar o status usando o protocolo da denúncia
app.get('/api/denuncias/protocolo/:protocolo', (req, res) => {
    const protocolo = req.params.protocolo;
    db.get('SELECT protocolo, status, data FROM denuncias WHERE protocolo = ?', [protocolo], (err, row) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else if (!row) {
            res.status(404).json({ erro: 'Denúncia não encontrada' });
        } else {
            res.json(row);
        }
    });
});

// POST - Criar nova denúncia
app.post('/api/denuncias', (req, res) => {
    const {
        protocolo,
        tipo,
        endereco,
        descricao,
        lat,
        lng,
        data,
        imagem,
        email: emailInformado,
        emailVerificationToken,
        identityMode = 'anonymous'
    } = req.body;
    const session = identityMode === 'simulated' ? obterSessaoDemonstrativa(req) : null;
    const citizenSession = identityMode === 'account' ? obterSessaoCidadao(req) : null;
    const email = normalizarEmail(emailInformado);

    if (emailInformado !== undefined && typeof emailInformado !== 'string') {
        return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (identityMode !== 'anonymous' && identityMode !== 'simulated' && identityMode !== 'account') {
        return res.status(400).json({ erro: 'Modo de identificação inválido' });
    }
    if (identityMode === 'simulated' && !session) {
        return res.status(401).json({ erro: 'Sessão demonstrativa ausente ou expirada' });
    }
    if (identityMode === 'account' && !citizenSession) {
        return res.status(401).json({ erro: 'Entre novamente com CPF e senha para enviar a denúncia.' });
    }
    if (email && !emailValido(email)) {
        return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (email && typeof emailVerificationToken !== 'string') {
        return res.status(401).json({ erro: 'Confirme seu e-mail antes de enviar a denúncia.' });
    }
    if (!email && emailVerificationToken) {
        return res.status(400).json({ erro: 'O e-mail informado não corresponde à confirmação.' });
    }

    const verificacaoEmail = emailVerificationToken ? verifiedEmails.get(emailVerificationToken) : null;
    if (email && (
        !verificacaoEmail
        || verificacaoEmail.expiresAt <= Date.now()
        || verificacaoEmail.consumed
        || verificacaoEmail.email !== email
    )) {
        verifiedEmails.delete(emailVerificationToken);
        return res.status(401).json({ erro: 'A confirmação do e-mail expirou ou não corresponde. Confirme o endereço novamente.' });
    }

    const autorHash = session
        ? `Identidade simulada • ${session.label} (${session.id})`
        : citizenSession
            ? 'Cidadão com conta (CPF não verificado)'
        : 'Cidadão Anônimo';
    const chaveRecuperacao = identityMode === 'anonymous' || email
        ? crypto.randomBytes(32).toString('hex')
        : null;
    const chaveRecuperacaoHash = chaveRecuperacao
        ? crypto.createHash('sha256').update(chaveRecuperacao).digest('hex')
        : null;

    console.log('Recebendo denúncia:', protocolo);
    console.log('Tem imagem?', !!imagem);

    if (!protocolo || !tipo || !endereco || !descricao || lat === undefined || lat === null || lng === undefined || lng === null || !data) {
        return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    }
    if (verificacaoEmail) verificacaoEmail.consumed = true;

    const sql = `
        INSERT INTO denuncias (protocolo, tipo, endereco, descricao, lat, lng, autorHash, autorCpf, triage_note, recovery_key_hash, data, imagem, citizen_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
    `;

    db.run(sql, [protocolo, tipo, endereco, descricao, lat, lng, autorHash, '', chaveRecuperacaoHash, data, imagem || null, citizenSession ? citizenSession.accountId : null], async function(err) {
        if (err) {
            if (verificacaoEmail) verificacaoEmail.consumed = false;
            console.error('Erro ao inserir denúncia:', err);
            res.status(500).json({ erro: err.message });
        } else {
            if (emailVerificationToken) verifiedEmails.delete(emailVerificationToken);
            console.log('Denúncia criada com sucesso:', protocolo);
            const resultado = { id: this.lastID, protocolo, status: 'Pendente' };
            if (chaveRecuperacao) resultado.chaveRecuperacao = chaveRecuperacao;

            if (email) {
                const conteudoChave = chaveRecuperacao
                    ? `\nChave secreta de recuperação: ${chaveRecuperacao}\nGuarde esta chave em local seguro. Ela permite recuperar o protocolo se você o perder.`
                    : '';
                try {
                    await emailTransporter.sendMail({
                        from: process.env.SMTP_FROM,
                        to: email,
                        subject: 'Protocolo da sua denúncia — ZeroFoco',
                        text: `Sua denúncia foi registrada e está pendente de triagem.\n\nProtocolo: ${protocolo}${conteudoChave}\n\nA equipe analisará o relato antes de qualquer encaminhamento.`
                    });
                    resultado.emailEnviado = true;
                } catch (error) {
                    console.error('Erro ao enviar recibo da denúncia por e-mail:', error.code || error.name || 'erro SMTP');
                    resultado.emailEnviado = false;
                    resultado.avisoEmail = 'A denúncia foi registrada, mas não foi possível enviar o recibo por e-mail. Guarde o protocolo e a chave exibidos nesta tela.';
                }
            }

            res.json(resultado);
        }
    });
});

// PUT - Atualizar status da denúncia
app.put('/api/denuncias/:protocolo', (req, res) => {
    const { status, nota = '' } = req.body;
    const protocolo = req.params.protocolo;
    const notaTriagem = typeof nota === 'string' ? nota.trim() : '';
    const transicoes = {
        'Pendente': ['Em Análise', 'Encerrada sem encaminhamento'],
        'Em Análise': ['Encaminhada', 'Aguardando informações', 'Encerrada sem encaminhamento'],
        'Aguardando informações': ['Em Análise', 'Encerrada sem encaminhamento'],
        'Encaminhada': ['Resolvido'],
        'Encerrada sem encaminhamento': [],
        'Resolvido': []
    };
    const estadosPermitidos = new Set([
        ...Object.keys(transicoes),
        ...Object.values(transicoes).flat()
    ]);

    if (!status) {
        return res.status(400).json({ erro: 'Status é obrigatório' });
    }
    if (!estadosPermitidos.has(status)) {
        return res.status(400).json({ erro: 'Status de triagem inválido' });
    }
    if (status !== 'Em Análise' && !notaTriagem) {
        return res.status(400).json({ erro: 'Registre uma nota para justificar esta decisão' });
    }

    db.get('SELECT status FROM denuncias WHERE protocolo = ?', [protocolo], (lookupError, row) => {
        if (lookupError) {
            res.status(500).json({ erro: lookupError.message });
            return;
        }
        if (!row) {
            res.status(404).json({ erro: 'Denúncia não encontrada' });
            return;
        }
        if (!transicoes[row.status] || !transicoes[row.status].includes(status)) {
            res.status(409).json({ erro: `Não é possível mudar de "${row.status}" para "${status}"` });
            return;
        }

        db.run('UPDATE denuncias SET status = ?, triage_note = ? WHERE protocolo = ?', [status, notaTriagem, protocolo], function(updateError) {
            if (updateError) {
                res.status(500).json({ erro: updateError.message });
            } else {
                res.json({ success: true, protocolo, status });
            }
        });
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
