lucide.createIcons();

const localPreviewUsesBackendPort = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && window.location.port !== '3000';
const API_URL = window.location.protocol === 'file:' || localPreviewUsesBackendPort
    ? 'http://localhost:3000/api'
    : `${window.location.origin}/api`;
const ENDERECO_INICIAL = 'Morrinhos, Goiás, Região Centro-Oeste, Brasil';
const LATITUDE_INICIAL = -17.7333689;
const LONGITUDE_INICIAL = -49.105908;

let currentUser = JSON.parse(localStorage.getItem('zerafoco_user')) || null;
let denuncias = [];
let filtroDenuncias = 'Todos';
let denunciaEmTriagem = null;
let demoSession = null;
let accountSession = null;
let modoAnonimo = false;
let localizacaoAlteradaPeloUsuario = false;
let envioDenunciaEmAndamento = false;

let map = null;
let marker = null;

window.onload = async function () {
    if (currentUser && currentUser.role === 'admin') {
        mostrarPainelCorreto();
    } else {
        currentUser = null;
        localStorage.removeItem('zerafoco_user');
        const citizenToken = sessionStorage.getItem('zerafoco_citizen_session');
        if (citizenToken) {
            accountSession = { token: citizenToken };
            if (sessionStorage.getItem('zerafoco_citizen_screen') === 'form') {
                abrirFormularioDenuncia();
            } else {
                await mostrarPainelCidadao();
            }
        } else {
            voltarInicio();
        }
    }
};

function voltarInicio() {
    atualizarNavContaCidadao(false);
    document.getElementById('home-section').classList.remove('hidden');
    document.getElementById('citizen-auth-section').classList.add('hidden');
    document.getElementById('citizen-account-section').classList.add('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    document.getElementById('user-info').classList.add('hidden');
}

function atualizarNavContaCidadao(ativa) {
    const button = document.getElementById('citizen-account-nav');
    const logoutButton = document.getElementById('citizen-logout-nav');
    button.classList.toggle('hidden', !ativa);
    logoutButton.classList.toggle('hidden', !ativa);
}

function iniciarDenuncia() {
    atualizarNavContaCidadao(false);
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('citizen-auth-section').classList.remove('hidden');
    document.getElementById('citizen-account-section').classList.add('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cpfTemDigitosValidos(cpf) {
    const numeros = cpf.replace(/\D/g, '');
    if (numeros.length !== 11 || /^(\d)\1{10}$/.test(numeros)) return false;

    const calcularDigito = tamanho => {
        let soma = 0;
        for (let indice = 0; indice < tamanho; indice++) {
            soma += Number(numeros[indice]) * (tamanho + 1 - indice);
        }
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };

    return calcularDigito(9) === Number(numeros[9])
        && calcularDigito(10) === Number(numeros[10]);
}

async function entrarContaCpf(event, action = 'entrar') {
    event.preventDefault();
    const input = document.getElementById('backup-cpf');
    const passwordInput = document.getElementById('backup-password');
    const button = action === 'cadastro'
        ? document.getElementById('backup-register-button')
        : document.getElementById('backup-login-button');
    const errorMessage = document.getElementById('backup-cpf-error');
    const cpf = input.value.replace(/\D/g, '');
    const senha = passwordInput.value;
    errorMessage.classList.add('hidden');

    if (!cpfTemDigitosValidos(cpf)) {
        errorMessage.textContent = 'CPF inválido. Confira os números e tente novamente.';
        errorMessage.classList.remove('hidden');
        return;
    }
    if (senha.length < 8 || senha.length > 128) {
        errorMessage.textContent = 'A senha deve ter entre 8 e 128 caracteres.';
        errorMessage.classList.remove('hidden');
        return;
    }

    button.disabled = true;
    const buttonLabel = button.textContent;
    button.textContent = action === 'cadastro' ? 'Criando conta...' : 'Entrando...';

    try {
        const response = await fetch(`${API_URL}/backup/cidadao/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, senha })
        });
        const result = await lerRespostaJson(response);
        if (!response.ok) {
            throw new Error(result.erro || 'Não foi possível acessar a conta.');
        }

        accountSession = { token: result.token };
        sessionStorage.setItem('zerafoco_citizen_session', result.token);
        sessionStorage.setItem('zerafoco_citizen_screen', action === 'entrar' ? 'history' : 'form');
        passwordInput.value = '';
        modoAnonimo = false;
        if (action === 'entrar') {
            await mostrarPainelCidadao();
        } else {
            abrirFormularioDenuncia();
        }
    } catch (error) {
        console.error('Erro ao acessar conta cidadã do backup:', error);
        errorMessage.textContent = error.message || 'Não foi possível conectar ao sistema.';
        errorMessage.classList.remove('hidden');
    } finally {
        button.disabled = false;
        button.textContent = buttonLabel;
    }
}

async function lerRespostaJson(response) {
    const body = await response.text();
    if (response.status === 404) {
        throw new Error('A API na porta 3000 ainda não tem as rotas de conta cidadã do backup. Pare o servidor antigo e inicie novamente com "npm start"; depois atualize esta página.');
    }
    if (!body.trim()) {
        throw new Error(`O servidor da API não retornou dados (HTTP ${response.status}). Verifique se o servidor do ZeroFoco está rodando na porta 3000.`);
    }

    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`O servidor da API retornou uma resposta inválida (HTTP ${response.status}). Verifique se a página está usando o servidor atualizado do ZeroFoco.`);
    }
}

function continuarSemIdentificacao() {
    demoSession = null;
    accountSession = null;
    sessionStorage.removeItem('zerafoco_citizen_session');
    sessionStorage.removeItem('zerafoco_citizen_screen');
    modoAnonimo = true;
    abrirFormularioDenuncia();
}

async function mostrarPainelCidadao(protocoloNovo = '') {
    if (accountSession) {
        sessionStorage.setItem('zerafoco_citizen_screen', 'history');
    }
    atualizarNavContaCidadao(true);
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('citizen-auth-section').classList.add('hidden');
    document.getElementById('citizen-account-section').classList.remove('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    document.getElementById('user-info').classList.add('hidden');
    await carregarDenunciasDaConta(protocoloNovo);
    lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function carregarDenunciasDaConta(protocoloNovo = '') {
    const list = document.getElementById('citizen-account-reports');
    const errorMessage = document.getElementById('citizen-account-error');
    list.innerHTML = '<p class="text-sm text-slate-500">Carregando suas denúncias...</p>';
    errorMessage.classList.add('hidden');

    try {
        const response = await fetch(`${API_URL}/backup/cidadao/denuncias`, {
            headers: { Authorization: `Bearer ${accountSession.token}` }
        });
        const result = await lerRespostaJson(response);
        if (!response.ok) {
            if (response.status === 401) {
                accountSession = null;
                sessionStorage.removeItem('zerafoco_citizen_session');
                sessionStorage.removeItem('zerafoco_citizen_screen');
                throw new Error('Sua sessão expirou. Entre novamente para consultar suas denúncias.');
            }
            throw new Error(result.erro || 'Não foi possível carregar suas denúncias.');
        }

        if (result.length === 0) {
            list.innerHTML = '<div class="rounded-xl border border-dashed border-slate-300 p-6 text-center"><p class="font-semibold text-slate-700">Nenhuma denúncia nesta conta ainda.</p><p class="mt-1 text-sm text-slate-500">Seus próximos protocolos aparecerão aqui.</p></div>';
            return;
        }

        list.innerHTML = result.map(denuncia => `
            <article class="rounded-xl border ${denuncia.protocolo === protocoloNovo ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 bg-white'} p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-mono text-sm font-extrabold text-brand-800">${escaparHtml(denuncia.protocolo)}</p>
                        <h3 class="mt-1 font-bold text-slate-900">${escaparHtml(denuncia.tipo)}</h3>
                        <p class="mt-1 text-xs text-slate-500">${escaparHtml(denuncia.endereco)} · ${escaparHtml(denuncia.data)}</p>
                    </div>
                    <span class="rounded-full px-3 py-1 text-xs font-semibold ${classeStatus(denuncia.status)}">${escaparHtml(rotuloStatus(denuncia.status))}</span>
                </div>
                <p class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">${escaparHtml(descricaoStatusDenuncia(denuncia.status))}</p>
                ${denuncia.protocolo === protocoloNovo ? '<p class="mt-3 text-xs font-semibold text-brand-800">Denúncia registrada. Guarde seu protocolo para referência.</p>' : ''}
            </article>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar histórico da conta cidadã:', error);
        list.innerHTML = '';
        errorMessage.textContent = error.message || 'Não foi possível carregar suas denúncias.';
        errorMessage.classList.remove('hidden');
    }
}

function iniciarNovaDenunciaComConta() {
    demoSession = null;
    modoAnonimo = false;
    abrirFormularioDenuncia();
}

async function sairDaContaCidadao() {
    const token = accountSession && accountSession.token;
    accountSession = null;
    sessionStorage.removeItem('zerafoco_citizen_session');
    sessionStorage.removeItem('zerafoco_citizen_screen');
    document.getElementById('denuncia-form').reset();
    if (token) {
        try {
            const response = await fetch(`${API_URL}/backup/cidadao/sair`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Não foi possível invalidar a sessão.');
        } catch (error) {
            console.error('Erro ao encerrar conta cidadã:', error);
        }
    }
    voltarInicio();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abrirFormularioDenuncia() {
    if (accountSession) {
        sessionStorage.setItem('zerafoco_citizen_screen', 'form');
    }
    atualizarNavContaCidadao(Boolean(accountSession));
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('citizen-auth-section').classList.add('hidden');
    document.getElementById('citizen-account-section').classList.add('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('citizen-section').classList.remove('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    document.getElementById('user-info').classList.add('hidden');

    const notice = document.getElementById('citizen-mode-notice');
    const submitLabel = document.getElementById('submit-denuncia-label');
    const identityBadge = document.getElementById('citizen-identity-badge');
    const sessionState = document.getElementById('citizen-session-state');
    const sessionName = document.getElementById('citizen-session-name');
    const sessionAction = document.getElementById('citizen-session-action');
    const sessionCard = document.getElementById('citizen-session-card');
    const backAction = document.getElementById('citizen-back-action');
    const sessionIcon = document.getElementById('citizen-session-icon');
    if (accountSession) {
        notice.textContent = 'Conta conectada. As denúncias enviadas por aqui ficarão vinculadas a esta conta e poderão ser acompanhadas em Minhas denúncias.';
        submitLabel.textContent = 'Enviar denúncia para minha conta';
        identityBadge.textContent = 'Conta conectada';
        backAction.classList.add('hidden');
        sessionCard.classList.add('hidden');
    } else if (demoSession) {
        notice.textContent = 'Modo demonstrativo: os dados informados não são enviados nem associados ao relato.';
        submitLabel.textContent = 'Enviar denúncia identificada (simulação)';
        identityBadge.textContent = 'Identidade simulada';
        sessionState.textContent = 'Sessão demonstrativa ativa';
        sessionName.textContent = demoSession.label;
        sessionIcon.innerHTML = '<i data-lucide="user-round-check" class="h-5 w-5 text-brand-700"></i>';
        sessionAction.querySelector('span').textContent = 'Sair da conta demonstrativa';
        sessionAction.setAttribute('onclick', 'sairDaAreaCidadao()');
        backAction.innerHTML = '<i data-lucide="arrow-left" class="h-4 w-4"></i> Voltar ao início';
        backAction.setAttribute('onclick', 'sairDaAreaCidadao()');
        backAction.classList.remove('hidden');
        sessionCard.classList.remove('hidden');
    } else {
        notice.textContent = 'Você está enviando sem identificação. Nenhum dado de perfil é associado ao relato; guarde o protocolo para consultar o andamento.';
        submitLabel.textContent = 'Enviar denúncia sem identificação';
        identityBadge.textContent = 'Anônimo';
        sessionState.textContent = 'Perfil anônimo';
        sessionName.textContent = 'Identidade não informada';
        sessionIcon.innerHTML = `
            <svg viewBox="0 0 24 24" class="h-7 w-7 text-brand-700" fill="none" role="img" aria-label="Máscara anônima">
                <path d="M3.1 8.2C4.2 4.7 7.8 2.5 12 2.5s7.8 2.2 8.9 5.7l-1 6.2c-.4 2.4-1.8 4.4-3.8 5.6L12 22l-4.1-2c-2-1.2-3.4-3.2-3.8-5.6l-1-6.2Z" fill="#ecfdf5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                <path d="m5.1 9.3 5.7-1.5-.8 3.1-4.5 1.2-.4-2.8Zm13.8 0-5.7-1.5.8 3.1 4.5 1.2.4-2.8Z" fill="currentColor" />
                <path d="m12 9.2-.9 5.1.9 1 .9-1L12 9.2Z" fill="#a7f3d0" stroke="currentColor" stroke-width=".7" stroke-linejoin="round" />
            </svg>
        `;
        sessionAction.querySelector('span').textContent = 'Trocar modo de envio';
        sessionAction.setAttribute('onclick', 'iniciarDenuncia()');
        backAction.innerHTML = '<i data-lucide="arrow-left" class="h-4 w-4"></i> Voltar ao início';
        backAction.setAttribute('onclick', 'voltarInicio()');
        backAction.classList.remove('hidden');
        sessionCard.classList.remove('hidden');
    }

    initMap();
    lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function sairDaAreaCidadao() {
    const sessionToRevoke = demoSession;
    demoSession = null;
    modoAnonimo = false;
    document.getElementById('denuncia-form').reset();

    if (sessionToRevoke) {
        try {
            const response = await fetch(`${API_URL}/demo-logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${sessionToRevoke.token}` }
            });
            if (!response.ok) {
                throw new Error('Não foi possível invalidar a sessão demonstrativa no servidor.');
            }
        } catch (error) {
            console.error('Erro ao encerrar sessão demonstrativa:', error);
            alert('A sessão foi encerrada nesta tela, mas não foi possível confirmar o encerramento no servidor. Ela expirará automaticamente em até 30 minutos.');
        }
    }

    voltarInicio();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarLoginFiscal() {
    atualizarNavContaCidadao(false);
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('citizen-auth-section').classList.add('hidden');
    document.getElementById('citizen-account-section').classList.add('hidden');
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    document.getElementById('user-info').classList.add('hidden');
    document.getElementById('auth-error').classList.add('hidden');
    document.getElementById('auth-input-1').focus();
}

async function handleLogin(event) {
    event.preventDefault();
    const usuario = document.getElementById('auth-input-1').value.trim();
    const senha = document.getElementById('auth-input-2-senha').value.trim();
    const errorMessage = document.getElementById('auth-error');
    errorMessage.classList.add('hidden');

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        const result = await response.json();
        if (!response.ok) {
            errorMessage.textContent = response.status === 401
                ? 'Usuário ou senha inválidos.'
                : (result.erro || 'Não foi possível entrar. Tente novamente.');
            errorMessage.classList.remove('hidden');
            return;
        }

        currentUser = { name: result.nome, role: result.role };
        localStorage.setItem('zerafoco_user', JSON.stringify(currentUser));
        mostrarPainelCorreto();
    } catch (error) {
        console.error('Erro ao autenticar fiscal:', error);
        errorMessage.textContent = 'Não foi possível conectar ao sistema. Tente novamente.';
        errorMessage.classList.remove('hidden');
    }
}

function logout() {
    localStorage.removeItem('zerafoco_user');
    currentUser = null;
    document.getElementById('auth-form').reset();
    demoSession = null;
    modoAnonimo = false;
    voltarInicio();
}

function mostrarPainelCorreto() {
    atualizarNavContaCidadao(false);
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('nav-username').innerText = `${currentUser.name} (${currentUser.role === 'admin' ? 'Fiscal' : 'Cidadão'})`;

    document.getElementById('admin-section').classList.remove('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    renderAdminTable();
}

// Buscar endereço reversamente ao clicar/arrastar no mapa
async function buscarEnderecoPorCoordenadas(lat, lng) {
    const inputEndereco = document.getElementById('den-endereco');
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        if (data && data.display_name) {
            inputEndereco.value = data.display_name;
        }
    } catch (error) {
        console.error("Erro ao buscar endereço", error);
    }
}

async function obterCoordenadasPorTexto(termo) {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}`);
    if (!response.ok) {
        throw new Error('O serviço de localização não está disponível.');
    }

    const resultados = await response.json();
    if (!Array.isArray(resultados) || !resultados.length) {
        throw new Error('Local ou CEP não encontrado. Tente adicionar a cidade (Ex: CEP 75650-000 ou Rua X, Morrinhos GO).');
    }

    const lat = Number(resultados[0].lat);
    const lng = Number(resultados[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('O serviço de localização retornou coordenadas inválidas.');
    }

    return { lat, lng, endereco: resultados[0].display_name };
}

function aplicarLocalizacaoNoMapa(lat, lng, zoom = 16) {
    map.setView([lat, lng], zoom);
    marker.setLatLng([lat, lng]);
    document.getElementById('den-lat').value = lat;
    document.getElementById('den-lng').value = lng;
}

async function buscarLocalPorTexto() {
    const inputEndereco = document.getElementById('den-endereco');
    const termo = inputEndereco.value.trim();
    if (!termo) return;
    localizacaoAlteradaPeloUsuario = true;

    try {
        const local = await obterCoordenadasPorTexto(termo);
        aplicarLocalizacaoNoMapa(local.lat, local.lng);
        inputEndereco.value = local.endereco;
    } catch (error) {
        alert(error.message || 'Erro ao buscar localização.');
    }
}

async function posicionarEnderecoInicialNoMapa() {
    try {
        const local = await obterCoordenadasPorTexto(ENDERECO_INICIAL);
        if (localizacaoAlteradaPeloUsuario) return;

        aplicarLocalizacaoNoMapa(local.lat, local.lng);
    } catch (error) {
        console.error('Erro ao posicionar o endereço inicial no mapa:', error);
    }
}

function initMap() {
    if (map) {
        localizacaoAlteradaPeloUsuario = false;
        map.invalidateSize();
        map.setView([LATITUDE_INICIAL, LONGITUDE_INICIAL], 14);
        marker.setLatLng([LATITUDE_INICIAL, LONGITUDE_INICIAL]);
        document.getElementById('den-endereco').value = ENDERECO_INICIAL;
        document.getElementById('den-lat').value = LATITUDE_INICIAL;
        document.getElementById('den-lng').value = LONGITUDE_INICIAL;
        posicionarEnderecoInicialNoMapa();
        return;
    }
    // Coordenadas de Morrinhos, GO
    map = L.map('map').setView([LATITUDE_INICIAL, LONGITUDE_INICIAL], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker([LATITUDE_INICIAL, LONGITUDE_INICIAL], { draggable: true }).addTo(map);

    localizacaoAlteradaPeloUsuario = false;
    document.getElementById('den-endereco').value = ENDERECO_INICIAL;
    document.getElementById('den-lat').value = LATITUDE_INICIAL;
    document.getElementById('den-lng').value = LONGITUDE_INICIAL;
    document.getElementById('den-endereco').addEventListener('input', () => {
        localizacaoAlteradaPeloUsuario = true;
    });

    marker.on('dragend', function (e) {
        localizacaoAlteradaPeloUsuario = true;
        const pos = marker.getLatLng();
        document.getElementById('den-lat').value = pos.lat;
        document.getElementById('den-lng').value = pos.lng;
        buscarEnderecoPorCoordenadas(pos.lat, pos.lng);
    });

    map.on('click', function (e) {
        localizacaoAlteradaPeloUsuario = true;
        marker.setLatLng(e.latlng);
        document.getElementById('den-lat').value = e.latlng.lat;
        document.getElementById('den-lng').value = e.latlng.lng;
        buscarEnderecoPorCoordenadas(e.latlng.lat, e.latlng.lng);
    });

    posicionarEnderecoInicialNoMapa();
}

async function criarDenuncia(event) {
    event.preventDefault();
    if (envioDenunciaEmAndamento) return;

    const tipo = document.getElementById('den-tipo').value;
    const endereco = document.getElementById('den-endereco').value;
    const descricao = document.getElementById('den-desc').value;
    const lat = document.getElementById('den-lat').value;
    const lng = document.getElementById('den-lng').value;
    const fotoInput = document.getElementById('den-foto');
    const submitButton = document.getElementById('submit-denuncia-button');
    const submitLabel = document.getElementById('submit-denuncia-label');
    const errorMessage = document.getElementById('denuncia-error');
    if (!accountSession && !demoSession && !modoAnonimo) {
        alert('Escolha novamente como deseja enviar a denúncia.');
        iniciarDenuncia();
        return;
    }

    errorMessage.classList.add('hidden');
    envioDenunciaEmAndamento = true;
    submitButton.disabled = true;

    try {
        const protocolo = "ZF-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
        const data = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        let imagemBase64 = null;
        if (fotoInput.files && fotoInput.files[0]) {
            imagemBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
                reader.readAsDataURL(fotoInput.files[0]);
            });
        }

        await enviarDenuncia(protocolo, tipo, endereco, descricao, lat, lng, data, imagemBase64);
    } catch (error) {
        console.error('Erro ao preparar a denúncia:', error);
        errorMessage.textContent = error.message || 'Não foi possível continuar. Tente novamente.';
        errorMessage.classList.remove('hidden');
        submitLabel.textContent = demoSession
            ? 'Enviar denúncia identificada (simulação)'
            : (accountSession ? 'Enviar denúncia para minha conta' : 'Enviar denúncia sem identificação');
    } finally {
        envioDenunciaEmAndamento = false;
        submitButton.disabled = false;
    }
}

async function enviarDenuncia(protocolo, tipo, endereco, descricao, lat, lng, data, imagem) {
    const nova = {
        protocolo,
        tipo,
        endereco,
        descricao,
        lat,
        lng,
        identityMode: accountSession ? 'account' : (demoSession ? 'simulated' : 'anonymous'),
        data,
        imagem
    };
    const headers = { 'Content-Type': 'application/json' };
    if (accountSession) {
        headers.Authorization = `Bearer ${accountSession.token}`;
    }
    if (demoSession) {
        headers.Authorization = `Bearer ${demoSession.token}`;
    }

    const response = await fetch(`${API_URL}/denuncias`, {
        method: 'POST',
        headers,
        body: JSON.stringify(nova)
    });
    const result = await lerRespostaJson(response);
    if (!response.ok) {
        if (response.status === 401 && accountSession) {
            accountSession = null;
            sessionStorage.removeItem('zerafoco_citizen_session');
            sessionStorage.removeItem('zerafoco_citizen_screen');
            throw new Error('Sua sessão expirou. Entre novamente com CPF e senha.');
        }
        if (response.status === 401 && demoSession) {
            demoSession = null;
            throw new Error('A sessão demonstrativa expirou. Inicie a simulação novamente.');
        }
        throw new Error(result.erro || 'Não foi possível registrar a denúncia.');
    }

    document.getElementById('denuncia-form').reset();
    renderCitizenProtocols(protocolo, result.chaveRecuperacao);
    document.getElementById('submit-denuncia-label').textContent = demoSession
        ? 'Enviar denúncia identificada (simulação)'
        : (accountSession ? 'Enviar denúncia para minha conta' : 'Enviar denúncia sem identificação');

    if (accountSession) {
        alert(`Denúncia registrada! Protocolo: ${protocolo}. Ela foi salva em Minhas denúncias.`);
    } else if (result.chaveRecuperacao) {
        alert(`Denúncia registrada!\nProtocolo: ${protocolo}\nChave de recuperação: ${result.chaveRecuperacao}\nGuarde a chave: ela não será exibida novamente.`);
    } else {
        alert(`Denúncia registrada com sucesso!\nGuarde seu protocolo: ${protocolo}`);
    }
}

function renderCitizenProtocols(protocolo, chaveRecuperacao) {
    const container = document.getElementById('citizen-protocols');
    container.innerHTML = `
        <div class="rounded-xl border border-brand-100 bg-brand-50 p-4">
            <p class="text-sm font-semibold text-brand-900">${accountSession ? 'Denúncia recebida e salva em Minhas denúncias. Guarde este protocolo:' : 'Denúncia recebida e pendente de triagem. Guarde este protocolo:'}</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <p id="citizen-protocol-code" class="font-mono text-lg font-extrabold tracking-wide text-brand-800">${protocolo}</p>
                <button id="copy-citizen-protocol" type="button" aria-label="Copiar protocolo" title="Copiar protocolo" class="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
                    <i data-lucide="copy" class="h-3.5 w-3.5"></i>
                    <span>Copiar</span>
                </button>
            </div>
            <p id="citizen-protocol-copy-status" class="mt-1 min-h-4 text-xs text-brand-700" role="status" aria-live="polite"></p>
            ${chaveRecuperacao ? `
                <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                    <p class="text-xs font-bold text-amber-950">Chave secreta para recuperar o protocolo</p>
                    <p class="mt-1 text-[11px] leading-relaxed text-amber-900">Guarde esta chave em local seguro. Ela será exibida apenas agora e permite recuperar o protocolo se você o perder.</p>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <code id="citizen-recovery-key" class="min-w-0 flex-1 break-all font-mono text-xs font-bold text-amber-950">${escaparHtml(chaveRecuperacao)}</code>
                        <button id="copy-citizen-recovery-key" type="button" aria-label="Copiar chave de recuperação" title="Copiar chave de recuperação" class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500">
                            <i data-lucide="copy" class="h-3.5 w-3.5"></i>
                            <span>Copiar chave</span>
                        </button>
                    </div>
                    <p id="citizen-recovery-key-copy-status" class="mt-1 min-h-4 text-xs text-amber-900" role="status" aria-live="polite"></p>
                </div>
            ` : demoSession ? `
                <p class="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">Esta conta é demonstrativa e ainda não possui histórico pessoal para recuperar o protocolo. Guarde o código acima.</p>
            ` : ''}
            <p class="mt-2 text-xs text-brand-800">${accountSession ? 'A equipe analisará o relato antes de qualquer encaminhamento. Consulte seus protocolos em Minhas denúncias.' : 'A equipe analisará o relato antes de qualquer encaminhamento. Consulte o andamento na página inicial usando este código.'}</p>
        </div>
    `;
    document.getElementById('copy-citizen-protocol').addEventListener('click', event => {
        copiarTexto(event.currentTarget, protocolo, document.getElementById('citizen-protocol-copy-status'), 'Copiado', 'Protocolo copiado.');
    });
    const copyRecoveryKeyButton = document.getElementById('copy-citizen-recovery-key');
    if (copyRecoveryKeyButton) {
        copyRecoveryKeyButton.addEventListener('click', event => {
            copiarTexto(event.currentTarget, chaveRecuperacao, document.getElementById('citizen-recovery-key-copy-status'), 'Copiada', 'Chave de recuperação copiada.');
        });
    }
    lucide.createIcons();
}

async function copiarTexto(button, texto, status, labelCopiado, mensagemSucesso) {
    try {
        await navigator.clipboard.writeText(texto);
        button.querySelector('span').textContent = labelCopiado;
        status.textContent = mensagemSucesso;
    } catch (error) {
        console.error('Erro ao copiar texto:', error);
        status.textContent = 'Não foi possível copiar. Selecione o texto e copie manualmente.';
    }
}

function statusParaExibicao(status) {
    return status === 'Pendente' ? 'Pendente de triagem' : status;
}

function descricaoStatusDenuncia(status) {
    return {
        'Pendente': 'Sua denúncia foi recebida e aguarda a triagem da equipe. Ela será analisada antes de qualquer encaminhamento.',
        'Em Análise': 'A equipe está avaliando a denúncia e as informações enviadas.',
        'Encaminhada': 'A denúncia foi encaminhada para atendimento pela equipe responsável.',
        'Aguardando informações': 'A análise está aguardando informações complementares para continuar.',
        'Encerrada sem encaminhamento': 'A análise foi encerrada sem encaminhamento para atendimento.',
        'Resolvido': 'O atendimento foi concluído conforme a última atualização da equipe.'
    }[status] || 'Consulte novamente mais tarde para verificar se houve atualização.';
}

async function consultarProtocolo(event) {
    event.preventDefault();
    const input = document.getElementById('protocolo-input');
    const result = document.getElementById('protocolo-result');
    const protocolo = input.value.trim().toUpperCase();
    result.textContent = 'Consultando protocolo...';
    result.classList.remove('hidden');

    try {
        const response = await fetch(`${API_URL}/denuncias/protocolo/${encodeURIComponent(protocolo)}`);
        const data = await response.json();
        if (!response.ok) {
            result.textContent = response.status === 404
                ? 'Protocolo não encontrado. Confira o código e tente novamente.'
                : (data.erro || 'Não foi possível consultar o protocolo.');
            return;
        }
        result.textContent = `Protocolo ${data.protocolo} • Status: ${statusParaExibicao(data.status)} • Registrada em ${data.data}`;
    } catch (error) {
        console.error('Erro ao consultar protocolo:', error);
        result.textContent = 'Não foi possível conectar ao sistema. Tente novamente.';
    }
}

async function recuperarProtocolo(event) {
    event.preventDefault();
    const input = document.getElementById('recovery-key-input');
    const result = document.getElementById('recovery-result');
    const chave = input.value.trim();
    result.textContent = 'Recuperando protocolo...';
    result.classList.remove('hidden');

    try {
        const response = await fetch(`${API_URL}/denuncias/recuperar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave })
        });
        const data = await response.json();
        if (!response.ok) {
            result.textContent = data.erro || 'Não foi possível recuperar o protocolo.';
            return;
        }

        document.getElementById('protocolo-input').value = data.protocolo;
        result.innerHTML = `
            <p class="font-semibold text-slate-900"></p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <code class="font-mono text-base font-extrabold text-brand-800"></code>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-50">
                    <i data-lucide="copy" class="h-3.5 w-3.5"></i><span>Copiar protocolo</span>
                </button>
            </div>
            <p class="mt-2 text-xs text-slate-600"></p>
            <p class="mt-1 min-h-4 text-xs text-brand-700" role="status" aria-live="polite"></p>
        `;
        result.querySelector('p').textContent = `Protocolo recuperado • Status: ${statusParaExibicao(data.status)}`;
        result.querySelector('code').textContent = data.protocolo;
        result.querySelectorAll('p')[1].textContent = `Registrada em ${data.data}. O protocolo também foi preenchido no campo acima para consultar novamente.`;
        const copyButton = result.querySelector('button');
        copyButton.addEventListener('click', () => {
            copiarTexto(copyButton, data.protocolo, result.querySelectorAll('p')[2], 'Copiado', 'Protocolo copiado.');
        });
        lucide.createIcons();
    } catch (error) {
        console.error('Erro ao recuperar protocolo:', error);
        result.textContent = 'Não foi possível conectar ao sistema. Tente novamente.';
    }
}

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caractere]);
}

function rotuloStatus(status) {
    return status === 'Pendente' ? 'Pendente de triagem' : status;
}

function classeStatus(status) {
    return {
        'Pendente': 'bg-amber-100 text-amber-800',
        'Em Análise': 'bg-sky-100 text-sky-800',
        'Encaminhada': 'bg-violet-100 text-violet-800',
        'Aguardando informações': 'bg-orange-100 text-orange-800',
        'Encerrada sem encaminhamento': 'bg-slate-100 text-slate-700',
        'Resolvido': 'bg-emerald-100 text-emerald-800'
    }[status] || 'bg-slate-100 text-slate-700';
}

function filtrarDenuncias(status) {
    filtroDenuncias = status;
    document.getElementById('admin-status-filter').value = status;
    renderListaTriagem();
}

async function renderAdminTable() {
    const list = document.getElementById('admin-report-list');
    list.innerHTML = '<p class="p-6 text-center text-sm text-slate-400">Carregando relatos...</p>';

    try {
        const response = await fetch(`${API_URL}/denuncias`);
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.erro || 'Não foi possível carregar a fila.');
        }
        denuncias = result;
        renderListaTriagem();
    } catch (error) {
        console.error('Erro ao buscar denúncias:', error);
        list.innerHTML = `<p class="p-6 text-center text-sm text-rose-700">${escaparHtml(error.message)}</p>`;
    }
}

function renderListaTriagem() {
    const list = document.getElementById('admin-report-list');
    const pendentes = denuncias.filter(item => item.status === 'Pendente').length;
    const emAnalise = denuncias.filter(item => item.status === 'Em Análise').length;
    const encaminhadas = denuncias.filter(item => item.status === 'Encaminhada').length;
    const aguardando = denuncias.filter(item => item.status === 'Aguardando informações').length;

    document.getElementById('admin-counter').textContent = `${denuncias.length} relatos`;
    document.getElementById('count-pending').textContent = pendentes;
    document.getElementById('count-review').textContent = emAnalise;
    document.getElementById('count-forwarded').textContent = encaminhadas;
    document.getElementById('count-waiting').textContent = aguardando;
    document.getElementById('admin-status-filter').value = filtroDenuncias;
    document.getElementById('admin-filter-description').textContent = filtroDenuncias === 'Todos'
        ? 'Todos os relatos, do mais recente ao mais antigo.'
        : `Exibindo relatos com status: ${rotuloStatus(filtroDenuncias)}.`;

    const filtradas = denuncias.filter(item => filtroDenuncias === 'Todos' || item.status === filtroDenuncias);
    if (filtradas.length === 0) {
        list.innerHTML = `<p class="p-8 text-center text-sm text-slate-500">${denuncias.length ? 'Nenhum relato neste status.' : 'Nenhum relato recebido ainda.'}</p>`;
        return;
    }

    list.innerHTML = filtradas.map(item => `
        <article class="p-5 sm:p-6 hover:bg-slate-50/70 transition">
          <div class="flex flex-col lg:flex-row lg:items-start gap-4 lg:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm font-extrabold text-brand-800">${escaparHtml(item.protocolo)}</span>
                <span class="rounded-full px-2.5 py-1 text-[11px] font-bold ${classeStatus(item.status)}">${escaparHtml(rotuloStatus(item.status))}</span>
              </div>
              <h4 class="mt-2 text-base font-extrabold text-slate-900">${escaparHtml(item.tipo)}</h4>
              <p class="mt-1 text-sm text-slate-600">${escaparHtml(item.endereco)}</p>
              <p class="mt-2 text-sm text-slate-500 line-clamp-2">${escaparHtml(item.descricao)}</p>
              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span class="inline-flex items-center gap-1"><i data-lucide="calendar-days" class="w-3.5 h-3.5"></i>${escaparHtml(item.data)}</span>
                <span class="inline-flex items-center gap-1"><i data-lucide="user-round" class="w-3.5 h-3.5"></i>${escaparHtml(item.autorHash || 'Cidadão Anônimo')}</span>
                ${item.imagem ? '<span class="inline-flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i>Com evidência</span>' : ''}
              </div>
            </div>
            <button type="button" data-review-protocol="${escaparHtml(item.protocolo)}" class="shrink-0 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition">
              <i data-lucide="scan-search" class="w-4 h-4"></i> Revisar relato
            </button>
          </div>
        </article>
    `).join('');

    list.querySelectorAll('[data-review-protocol]').forEach(button => {
        button.addEventListener('click', () => abrirTriage(button.dataset.reviewProtocol));
    });
    lucide.createIcons();
}

function abrirTriage(protocolo) {
    denunciaEmTriagem = denuncias.find(item => item.protocolo === protocolo);
    if (!denunciaEmTriagem) return;

    const item = denunciaEmTriagem;
    document.getElementById('triage-modal-protocol').textContent = item.protocolo;
    document.getElementById('triage-modal-type').textContent = item.tipo;
    document.getElementById('triage-modal-date').textContent = item.data;
    document.getElementById('triage-modal-identity').textContent = item.autorHash || 'Cidadão Anônimo';
    document.getElementById('triage-modal-status').textContent = `Status atual: ${rotuloStatus(item.status)}`;
    document.getElementById('triage-modal-address').textContent = item.endereco;
    document.getElementById('triage-modal-coordinates').textContent = `Coordenadas: ${item.lat}, ${item.lng}`;
    document.getElementById('triage-modal-description').textContent = item.descricao;
    document.getElementById('triage-note').value = '';
    document.getElementById('triage-modal-error').classList.add('hidden');

    const noteWrapper = document.getElementById('triage-modal-last-note-wrapper');
    noteWrapper.classList.toggle('hidden', !item.triage_note);
    document.getElementById('triage-modal-last-note').textContent = item.triage_note || '';

    const imageWrapper = document.getElementById('triage-modal-image-wrapper');
    const image = document.getElementById('triage-modal-image');
    if (typeof item.imagem === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(item.imagem)) {
        image.src = item.imagem;
        imageWrapper.classList.remove('hidden');
    } else {
        image.removeAttribute('src');
        imageWrapper.classList.add('hidden');
    }

    renderAcoesTriagem(item);
    document.getElementById('triage-modal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function renderAcoesTriagem(item) {
    const actions = document.getElementById('triage-actions');
    const options = {
        'Pendente': [
            ['Em Análise', 'Iniciar análise', 'bg-sky-700 hover:bg-sky-800', 'scan-search'],
            ['Encerrada sem encaminhamento', 'Encerrar sem encaminhar', 'bg-slate-600 hover:bg-slate-700', 'circle-slash']
        ],
        'Em Análise': [
            ['Encaminhada', 'Encaminhar para fiscalização', 'bg-violet-700 hover:bg-violet-800', 'send'],
            ['Aguardando informações', 'Aguardar informações', 'bg-orange-600 hover:bg-orange-700', 'message-circle-question'],
            ['Encerrada sem encaminhamento', 'Encerrar sem encaminhar', 'bg-slate-600 hover:bg-slate-700', 'circle-slash']
        ],
        'Aguardando informações': [
            ['Em Análise', 'Retomar análise', 'bg-sky-700 hover:bg-sky-800', 'scan-search'],
            ['Encerrada sem encaminhamento', 'Encerrar sem encaminhar', 'bg-slate-600 hover:bg-slate-700', 'circle-slash']
        ],
        'Encaminhada': [
            ['Resolvido', 'Marcar atendimento como resolvido', 'bg-emerald-700 hover:bg-emerald-800', 'check-check']
        ]
    }[item.status] || [];

    actions.innerHTML = options.map(([status, label, color, icon]) => `
      <button type="button" data-next-status="${escaparHtml(status)}" class="${color} text-white px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition">
        <i data-lucide="${icon}" class="w-4 h-4"></i>${label}
      </button>
    `).join('') + `
      <button type="button" id="triage-delete-button" class="mr-auto text-rose-700 hover:bg-rose-50 px-3 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition">
        <i data-lucide="trash-2" class="w-4 h-4"></i> Excluir relato
      </button>
    `;

    actions.querySelectorAll('[data-next-status]').forEach(button => {
        button.addEventListener('click', () => atualizarStatus(item.protocolo, button.dataset.nextStatus));
    });
    document.getElementById('triage-delete-button').addEventListener('click', () => removerDenuncia(item.protocolo));
    lucide.createIcons();
}

function fecharTriageModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('triage-modal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    denunciaEmTriagem = null;
}

async function atualizarStatus(protocolo, novoStatus) {
    const notaInput = document.getElementById('triage-note');
    const errorMessage = document.getElementById('triage-modal-error');
    const nota = notaInput.value.trim();
    errorMessage.classList.add('hidden');

    if (novoStatus !== 'Em Análise' && !nota) {
        errorMessage.textContent = 'Registre uma nota explicando esta decisão antes de continuar.';
        errorMessage.classList.remove('hidden');
        notaInput.focus();
        return;
    }

    try {
        const response = await fetch(`${API_URL}/denuncias/${encodeURIComponent(protocolo)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novoStatus, nota })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.erro || 'Não foi possível atualizar a triagem.');
        }

        fecharTriageModal();
        await renderAdminTable();
    } catch (error) {
        console.error('Erro ao atualizar triagem:', error);
        errorMessage.textContent = error.message;
        errorMessage.classList.remove('hidden');
    }
}

function removerDenuncia(protocolo) {
    if (confirm("Deseja realmente excluir esta denúncia?")) {
        fetch(`${API_URL}/denuncias/${protocolo}`, {
            method: 'DELETE'
        })
        .then(async response => {
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.erro || 'Não foi possível excluir o relato.');
            }
            fecharTriageModal();
            await renderAdminTable();
        })
        .catch(error => {
            console.error('Erro ao excluir relato:', error);
            const errorMessage = document.getElementById('triage-modal-error');
            errorMessage.textContent = error.message;
            errorMessage.classList.remove('hidden');
        });
    }
}
