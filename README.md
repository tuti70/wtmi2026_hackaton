# ZeroFoco

## Configurar e-mail por SMTP

O e-mail é opcional. Quando informado, o sistema envia um código de confirmação e só registra a denúncia depois que o código é validado. Em seguida, envia o protocolo e a chave de recuperação para o endereço confirmado. Sem e-mail, a denúncia continua anônima e a chave é exibida na tela.

1. Copie `.env.example` para `.env`.
2. Preencha as configurações do seu provedor SMTP:
   - `SMTP_HOST`: servidor SMTP.
   - `SMTP_PORT`: normalmente `587` para STARTTLS ou `465` para TLS.
   - `SMTP_SECURE`: use `false` para porta 587 e `true` para porta 465.
   - `SMTP_USER` e `SMTP_PASS`: credenciais SMTP, quando exigidas pelo provedor.
   - `SMTP_FROM`: endereço autorizado pelo provedor para envio.
3. Inicie o servidor com `npm start`.

O arquivo `.env` é ignorado pelo Git. Nunca coloque credenciais SMTP no código, no `.env.example` ou em commits. Sem uma configuração SMTP válida, o sistema informa que não pode enviar o código e não conclui a denúncia com e-mail.

O endereço de e-mail não é salvo no banco de denúncias nem exposto à fiscalização; fica em memória apenas durante a confirmação e o envio. Códigos de confirmação e confirmações pendentes expiram, e a chave de recuperação é armazenada somente como hash.

## Versão de backup com conta cidadã

A cópia em `backup/` permite criar uma conta demonstrativa e consultar o histórico usando CPF e senha. O CPF não tem titularidade verificada; o servidor usa um HMAC do número como identificador e salva somente esse identificador. A senha é derivada com `scrypt`.

Para manter as contas recuperáveis, preserve o banco `denuncias.db` e a chave local `~/.zerofoco/cpf-hash.key`. Consulte [backup/README.md](./backup/README.md) para os limites e detalhes desse fluxo. Não use credenciais ou CPFs reais: este protótipo não substitui autenticação de identidade por um provedor autorizado.
