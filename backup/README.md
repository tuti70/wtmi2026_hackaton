# ZeroFoco — versão de backup com conta cidadã

Esta cópia mantém o visual atual e permite criar uma conta ou entrar usando CPF e senha. Após entrar, o cidadão vai direto ao formulário de denúncia. Os protocolos ficam disponíveis na opção “Minhas denúncias”, dentro da área do cidadão; enviar um novo relato não tira o usuário do formulário.

## Importante

- A validação dos dígitos do CPF não confirma a identidade nem a titularidade.
- Para localizar a conta, o CPF é enviado ao servidor e transformado em HMAC com uma chave aleatória guardada fora do projeto, em `~/.zerofoco/cpf-hash.key`. O CPF em texto não é salvo no banco. Preserve essa chave junto com o banco de dados; sem ela, as contas existentes não poderão ser localizadas.
- A senha é armazenada com salt aleatório e derivação `scrypt`. Sessões expiram em 12 horas ou quando o servidor reinicia.
- Este fluxo é demonstrativo, sem recuperação de senha nem integração com um provedor oficial de identidade. Não use CPFs ou senhas reais.

Com o servidor principal atualizado e em execução, abra `http://localhost:3000/backup/`. A versão principal permanece na raiz do projeto e não é alterada por esta cópia.
