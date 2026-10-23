# ZeroFoco

## Recuperar denúncias

A opção de informar e-mail foi removida temporariamente da tela de denúncia. Denúncias enviadas com uma conta ficam disponíveis em “Minhas denúncias”. No envio anônimo, guarde o protocolo e a chave de recuperação exibidos na tela; a chave permite recuperar o protocolo se ele for perdido.

## Conta cidadã com CPF e senha

A aplicação principal permite criar uma conta demonstrativa e consultar o histórico usando CPF e senha. A sessão cidadã é mantida durante atualizações da página na mesma aba; ela expira após 12 horas ou quando o servidor é reiniciado. O CPF não tem titularidade verificada; o servidor usa um HMAC do número como identificador e salva somente esse identificador. A senha é derivada com `scrypt`.

Para manter as contas recuperáveis, preserve o banco `denuncias.db` e a chave local `~/.zerofoco/cpf-hash.key`. A cópia em `backup/` mantém o mesmo fluxo. Consulte [backup/README.md](./backup/README.md) para os limites e detalhes. Não use credenciais ou CPFs reais: este protótipo não substitui autenticação de identidade por um provedor autorizado.
