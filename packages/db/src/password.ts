import {
  type BinaryLike,
  randomBytes,
  type ScryptOptions,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * =============================================================================
 * SENHA DA REDAÇÃO — derivação e verificação
 * =============================================================================
 *
 * POR QUE ESTE ARQUIVO VIVE EM `packages/db` E NÃO EM `apps/web/src/server`:
 * ele tem DOIS consumidores que não compartilham runtime — a rota de login do
 * Next e o script de linha de comando que cria a primeira conta admin
 * (`packages/db/scripts/staff-account.ts`, rodado com tsx, fora do Next). Uma
 * cópia em cada lado seria a pior forma possível de duplicação: no dia em que o
 * custo do scrypt subisse em um dos dois, o script passaria a gravar hashes que
 * o login não consegue conferir, e o sintoma seria "a senha que acabei de criar
 * não funciona" — sem erro em log nenhum.
 *
 * Mora junto do banco porque é a REGRA DE COMO A CREDENCIAL É ARMAZENADA, que é
 * assunto de persistência: o formato do hash e o schema evoluem juntos.
 *
 * NÃO tem `import 'server-only'`, ao contrário dos módulos de `apps/web/src/server`.
 * Esse marcador foi feito para explodir fora do Next — exatamente onde o script
 * roda. A proteção contra ir parar no bundle do navegador continua existindo na
 * prática: `node:crypto` não existe no cliente, então um import indevido
 * quebraria o build de qualquer forma.
 *
 * -----------------------------------------------------------------------------
 * ESCOLHA DO ALGORITMO: scrypt, da biblioteca padrão do Node.
 * -----------------------------------------------------------------------------
 * Por que não SHA-256 (nem MD5): são rápidos DE PROPÓSITO, e velocidade é
 * exatamente o que não se quer aqui. Uma GPU testa bilhões de SHA-256 por
 * segundo; como senha humana tem entropia baixa, um vazamento do banco viraria
 * senha em claro em minutos. (Note a diferença para `hashToken` em
 * apps/web/src/server/security.ts, que usa SHA-256 puro e está CERTO: lá o
 * segredo tem 256 bits aleatórios e não existe dicionário de valores prováveis.)
 *
 * Por que não bcrypt/argon2: são ótimos, mas vêm como dependência NATIVA
 * (compilam C na instalação). Numa hospedagem compartilhada, dependência nativa
 * é a que quebra primeiro — e trocar o algoritmo de senha às pressas, no dia do
 * deploy, é o pior momento possível. scrypt já vem no Node, é memory-hard
 * (resistente a GPU/ASIC) e é recomendado pelo OWASP.
 */

// A ANOTAÇÃO DE TIPO ABAIXO NÃO É ENFEITE. `crypto.scrypt` tem duas sobrecargas
// (com e sem `options`) e não declara o `__promisify__` que o TypeScript usa
// para saber qual delas o `promisify` produz. Sem dizer explicitamente, ele
// escolhe a de 3 argumentos e acusa erro nas chamadas que passam `options` —
// que são justamente as que ajustam o custo do scrypt.
const scrypt = promisify(scryptCallback) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// N=2^15 com r=8 usa ~32 MB por verificação: caro o bastante para inviabilizar
// força bruta em massa, barato o bastante para um login não travar o servidor.
// `maxmem` precisa subir junto, senão o Node recusa a operação com N acima do
// padrão.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

/** Tamanho mínimo aceito. Ver `validateStaffPassword`. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Deriva o hash de uma senha, no formato `scrypt$N$r$p$sal$hash`.
 *
 * O SAL é ALEATÓRIO E POR SENHA. Sem ele, senhas iguais gerariam hashes iguais —
 * o que entrega ao atacante quais contas compartilham senha e permite atacar
 * todas de uma vez com uma tabela pré-calculada (rainbow table).
 *
 * Os parâmetros vão GRAVADOS no próprio hash. É isso que torna possível
 * endurecer o custo no futuro sem invalidar as senhas já existentes: cada hash
 * carrega a receita usada para criá-lo.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  // `normalize('NFKC')` porque a MESMA senha digitada num Mac e num Windows pode
  // chegar com acentos em formas Unicode diferentes ("á" como um caractere ou
  // como a + acento combinante). Sem normalizar, a pessoa cria a senha numa
  // máquina e não consegue entrar na outra.
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Confere uma senha contra o hash guardado.
 *
 * A comparação usa `timingSafeEqual`, e não `===`: comparação comum de strings
 * retorna no primeiro byte diferente, e a diferença de tempo permite descobrir o
 * valor correto byte a byte medindo a latência das respostas.
 *
 * Qualquer formato inesperado devolve `false` em vez de lançar. Um hash
 * corrompido no banco deve significar "não entra", nunca uma exceção que derrube
 * a rota de login (ou que revele detalhes no log de erro).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (!saltRaw || !hashRaw) return false;

  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(hashRaw, 'base64');

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Política de senha.
 *
 * COMPRIMENTO MÍNIMO ALTO (12) E NENHUMA EXIGÊNCIA DE "UM SÍMBOLO E UM NÚMERO".
 * É a recomendação atual do NIST (SP 800-63B) e do OWASP, e a razão é medida, não
 * ideológica: regras de composição empurram as pessoas para padrões previsíveis
 * ("Senha@2026!"), que os dicionários de ataque já conhecem, enquanto o
 * comprimento é o único fator que aumenta o espaço de busca de verdade. Uma frase
 * de quatro palavras passa aqui e é ordens de grandeza mais forte.
 *
 * O TETO de 200 caracteres não é política de segurança: é proteção contra
 * negação de serviço. Cada verificação custa ~32 MB de memória, e uma senha de
 * megabytes só serve para fazer o servidor trabalhar de graça.
 */
export function validateStaffPassword(input: unknown): { ok: true; password: string } | { ok: false; message: string } {
  if (typeof input !== 'string') {
    return { ok: false, message: 'Senha inválida.' };
  }

  // A senha NÃO leva `trim()`: espaço no início ou no fim é parte legítima de
  // uma frase-senha, e removê-lo em silêncio faria a pessoa criar uma senha e
  // não conseguir entrar com ela.
  if (input.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres. Uma frase curta funciona bem.`,
    };
  }

  if (input.length > 200) {
    return { ok: false, message: 'A senha passa de 200 caracteres.' };
  }

  return { ok: true, password: input };
}
