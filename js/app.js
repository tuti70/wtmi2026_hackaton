lucide.createIcons();

const API_URL = 'http://localhost:3000/api';

let currentUser = JSON.parse(localStorage.getItem('zerafoco_user')) || null;
let denuncias = [];

let map = null;
let marker = null;

window.onload = function () {
    if (currentUser) {
        mostrarPainelCorreto();
    }
};

function validarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0, resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    return true;
}

function handleLogin(event) {
    event.preventDefault();
    const usuario = document.getElementById('auth-input-1').value.trim();
    const senha = document.getElementById('auth-input-2-senha').value.trim();
    const cpf = document.getElementById('auth-input-2-cpf').value.trim();

    // Validar se é administrador (usuario + senha corretos)
    if ((usuario === 'admin' && senha === 'admin') || (usuario === 'admin123' && senha === 'admin123')) {
        currentUser = { name: 'Fiscal Operacional', role: 'admin' };
        localStorage.setItem('zerafoco_user', JSON.stringify(currentUser));
        mostrarPainelCorreto();
        return;
    }

    // Validar se é cidadão (CPF válido)
    if (!validarCPF(cpf)) {
        alert("CPF inválido! Digite um CPF real e válido.");
        document.getElementById('auth-input-2-cpf').focus();
        return;
    }

    const hashId = "Anônimo (#" + cpf.slice(-4) + ")";
    currentUser = { name: usuario, cpf: cpf, hashId: hashId, role: 'cidadao' };
    localStorage.setItem('zerafoco_user', JSON.stringify(currentUser));
    mostrarPainelCorreto();
}

function logout() {
    localStorage.removeItem('zerafoco_user');
    currentUser = null;
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('citizen-section').classList.add('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    document.getElementById('user-info').classList.add('hidden');
    document.getElementById('auth-form').reset();
}

function mostrarPainelCorreto() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('nav-username').innerText = `${currentUser.name} (${currentUser.role === 'admin' ? 'Fiscal' : 'Cidadão'})`;

    if (currentUser.role === 'admin') {
        document.getElementById('admin-section').classList.remove('hidden');
        document.getElementById('citizen-section').classList.add('hidden');
        renderAdminTable();
    } else {
        document.getElementById('citizen-section').classList.remove('hidden');
        document.getElementById('admin-section').classList.add('hidden');
        initMap();
        renderCitizenProtocols();
    }
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

// Buscar coordenadas quando o usuário digitar um CEP ou Endereço e clicar em Buscar
async function buscarLocalPorTexto() {
    const termo = document.getElementById('den-endereco').value;
    if (!termo) return;

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);

            map.setView([lat, lng], 16);
            marker.setLatLng([lat, lng]);
            document.getElementById('den-lat').value = lat;
            document.getElementById('den-lng').value = lng;
            document.getElementById('den-endereco').value = data[0].display_name;
        } else {
            alert("Local ou CEP não encontrado. Tente adicionar a cidade (Ex: CEP 75650-000 ou Rua X, Morrinhos GO).");
        }
    } catch (error) {
        alert("Erro ao buscar localização.");
    }
}

function initMap() {
    if (map) {
        map.invalidateSize();
        return;
    }
    // Coordenadas de Morrinhos, GO
    const latInicial = -17.7326;
    const lngInicial = -50.3168;

    map = L.map('map').setView([latInicial, lngInicial], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker([latInicial, lngInicial], { draggable: true }).addTo(map);

    document.getElementById('den-endereco').value = 'Morrinhos, GO';
    document.getElementById('den-lat').value = latInicial;
    document.getElementById('den-lng').value = lngInicial;

    marker.on('dragend', function (e) {
        const pos = marker.getLatLng();
        document.getElementById('den-lat').value = pos.lat;
        document.getElementById('den-lng').value = pos.lng;
        buscarEnderecoPorCoordenadas(pos.lat, pos.lng);
    });

    map.on('click', function (e) {
        marker.setLatLng(e.latlng);
        document.getElementById('den-lat').value = e.latlng.lat;
        document.getElementById('den-lng').value = e.latlng.lng;
        buscarEnderecoPorCoordenadas(e.latlng.lat, e.latlng.lng);
    });
}

function criarDenuncia(event) {
    event.preventDefault();
    const tipo = document.getElementById('den-tipo').value;
    const endereco = document.getElementById('den-endereco').value;
    const descricao = document.getElementById('den-desc').value;
    const lat = document.getElementById('den-lat').value;
    const lng = document.getElementById('den-lng').value;
    const fotoInput = document.getElementById('den-foto');

    const protocolo = "DEN-" + Math.floor(1000 + Math.random() * 9000);
    const data = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Converter imagem para base64
    let imagemBase64 = null;
    if (fotoInput.files && fotoInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            imagemBase64 = e.target.result;
            enviarDenuncia(protocolo, tipo, endereco, descricao, lat, lng, data, imagemBase64);
        };
        reader.readAsDataURL(fotoInput.files[0]);
    } else {
        enviarDenuncia(protocolo, tipo, endereco, descricao, lat, lng, data, null);
    }
}

function enviarDenuncia(protocolo, tipo, endereco, descricao, lat, lng, data, imagem) {
    const nova = {
        protocolo,
        tipo,
        endereco,
        descricao,
        lat,
        lng,
        autorCpf: currentUser.cpf,
        autorHash: currentUser.hashId,
        data,
        imagem
    };

    fetch(`${API_URL}/denuncias`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(nova)
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById('denuncia-form').reset();
        alert("Denúncia anônima registrada com sucesso!\nProtocolo gerado: " + protocolo);
        renderCitizenProtocols();
    })
    .catch(error => {
        console.error('Erro:', error);
        alert("Erro ao registrar denúncia. Tente novamente.");
    });
}

function renderCitizenProtocols() {
    const container = document.getElementById('citizen-protocols');
    
    // Buscar denúncias do cidadão
    fetch(`${API_URL}/denuncias/${currentUser.cpf}`)
        .then(response => response.json())
        .then(minhas => {
            if (minhas.length === 0) {
                container.innerHTML = `<p class="text-sm text-slate-400">Você ainda não registrou nenhuma denúncia nesta sessão.</p>`;
                return;
            }

            container.innerHTML = minhas.map(d => `
                <div class="p-4 rounded-xl border border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">${d.protocolo}</span>
                        <h4 class="font-bold text-sm text-slate-800 mt-1">${d.tipo}</h4>
                        <p class="text-xs text-slate-500">${d.endereco} • ${d.data}</p>
                    </div>
                    <div>
                        <span class="text-xs px-2.5 py-1 rounded-full font-medium ${d.status === 'Pendente' ? 'bg-amber-100 text-amber-700' : d.status === 'Em Análise' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}">${d.status}</span>
                    </div>
                </div>
            `).join('');
        })
        .catch(error => console.error('Erro ao buscar denúncias:', error));
}

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    
    // Buscar todas as denúncias
    fetch(`${API_URL}/denuncias`)
        .then(response => response.json())
        .then(todasDenuncias => {
            document.getElementById('admin-counter').innerText = `${todasDenuncias.length} Denúncias`;

            if (todasDenuncias.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">Nenhuma denúncia cadastrada.</td></tr>`;
                return;
            }

            tbody.innerHTML = todasDenuncias.map((d, index) => `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-4">
                        <span class="font-bold text-emerald-600">${d.protocolo}</span>
                        <div class="text-xs text-slate-400">${d.data}</div>
                    </td>
                    <td class="p-4 font-medium text-slate-700">${d.tipo}</td>
                    <td class="p-4 text-slate-600 text-xs">${d.endereco}<br><span class="text-slate-400">${d.descricao}</span></td>
                    <td class="p-4 text-slate-600 text-xs">
                        <span class="bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono text-xs font-semibold">🔒 ${d.autorHash || 'Cidadão Anônimo'}</span>
                    </td>
                    <td class="p-4">
                        <select onchange="atualizarStatus('${d.protocolo}', this.value)" class="text-xs px-2.5 py-1 rounded-lg border border-slate-200 font-medium ${d.status === 'Pendente' ? 'bg-amber-50 text-amber-700' : d.status === 'Em Análise' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}">
                        <option value="Pendente" ${d.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                            <option value="Em Análise" ${d.status === 'Em Análise' ? 'selected' : ''}>Em Análise</option>
                            <option value="Resolvido" ${d.status === 'Resolvido' ? 'selected' : ''}>Resolvido</option>
                        </select>
                    </td>
                    <td class="p-4 text-right space-x-2 flex justify-end">
                        ${d.imagem ? `<button onclick="visualizarImagem('${d.imagem.replace(/'/g, "\\'")}')" class="text-blue-500 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50 transition" title="Ver imagem">
                            <i data-lucide="image" class="w-4 h-4"></i>
                        </button>` : ''}
                        <button onclick="removerDenuncia('${d.protocolo}')" class="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition" title="Excluir">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
            lucide.createIcons();
        })
        .catch(error => console.error('Erro ao buscar denúncias:', error));
}

function visualizarImagem(imagemBase64) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;
    modal.onclick = () => modal.remove();
    
    modal.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 10px; max-width: 90%; max-height: 90%; overflow: auto;">
            <img src="${imagemBase64}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
        </div>
    `;
    
    document.body.appendChild(modal);
}

function atualizarStatus(protocolo, novoStatus) {
    fetch(`${API_URL}/denuncias/${protocolo}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: novoStatus })
    })
    .then(response => response.json())
    .then(data => {
        renderAdminTable();
    })
    .catch(error => console.error('Erro:', error));
}

function removerDenuncia(protocolo) {
    if (confirm("Deseja realmente excluir esta denúncia?")) {
        fetch(`${API_URL}/denuncias/${protocolo}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            renderAdminTable();
        })
        .catch(error => console.error('Erro:', error));
    }
}
