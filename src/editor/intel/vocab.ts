/**
 * Keywords, common builtins and snippets for languages whose CodeMirror
 * package does not complete them itself (JS/TS, Python, CSS, HTML, SQL and
 * friends already do). Builtins carry a one-line description for hover cards.
 */

export interface Snippet {
  label: string;
  /** CodeMirror snippet template: ${name} fields, ${} cursor end. */
  body: string;
  detail: string;
}

export interface Vocab {
  keywords: string[];
  /** name → short description. */
  builtins?: Record<string, string>;
  types?: string[];
  snippets?: Snippet[];
}

const words = (s: string) => s.trim().split(/\s+/);

const C_TYPES = words("void char short int long float double signed unsigned bool size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t");

export const VOCAB: Record<string, Vocab> = {
  rust: {
    keywords: words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while"),
    types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Some None Result Ok Err Box Rc Arc RefCell Cell HashMap HashSet BTreeMap BTreeSet VecDeque Mutex RwLock Path PathBuf"),
    builtins: {
      println: "println!(fmt, args…) — print to stdout with a newline",
      print: "print!(fmt, args…) — print to stdout",
      eprintln: "eprintln!(fmt, args…) — print to stderr with a newline",
      format: "format!(fmt, args…) -> String",
      vec: "vec![a, b, c] — build a Vec",
      panic: "panic!(msg) — abort the current thread",
      assert: "assert!(cond, msg?) — panic if false",
      assert_eq: "assert_eq!(left, right) — panic if not equal",
      todo: "todo!() — not yet implemented",
      unimplemented: "unimplemented!()",
      unreachable: "unreachable!()",
      dbg: "dbg!(expr) — print an expression with its value to stderr",
      write: "write!(dst, fmt, args…)",
      writeln: "writeln!(dst, fmt, args…)",
      matches: "matches!(expr, pattern) -> bool",
    },
    snippets: [
      { label: "fn", body: "fn ${name}(${}) {\n\t${}\n}", detail: "function" },
      { label: "pfn", body: "pub fn ${name}(${}) -> ${Type} {\n\t${}\n}", detail: "public function" },
      { label: "struct", body: "#[derive(Debug, Clone)]\nstruct ${Name} {\n\t${field}: ${Type},\n}", detail: "struct" },
      { label: "enum", body: "enum ${Name} {\n\t${Variant},\n}", detail: "enum" },
      { label: "impl", body: "impl ${Type} {\n\t${}\n}", detail: "impl block" },
      { label: "match", body: "match ${expr} {\n\t${pattern} => ${},\n\t_ => ${},\n}", detail: "match" },
      { label: "iflet", body: "if let Some(${x}) = ${expr} {\n\t${}\n}", detail: "if let" },
      { label: "for", body: "for ${item} in ${iter} {\n\t${}\n}", detail: "for loop" },
      { label: "test", body: "#[test]\nfn ${name}() {\n\t${}\n}", detail: "unit test" },
      { label: "main", body: "fn main() {\n\t${}\n}", detail: "main function" },
    ],
  },
  go: {
    keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota"),
    types: words("bool string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr byte rune float32 float64 complex64 complex128 error any"),
    builtins: {
      append: "append(slice, elems...) []T — append to a slice",
      cap: "cap(v) int — capacity",
      close: "close(ch) — close a channel",
      copy: "copy(dst, src) int",
      delete: "delete(m, key) — remove a map entry",
      len: "len(v) int — length",
      make: "make(T, size...) T — slice, map or channel",
      new: "new(T) *T",
      panic: "panic(v)",
      recover: "recover() any",
      print: "print(args...)",
      println: "println(args...)",
      min: "min(x, y...) T",
      max: "max(x, y...) T",
      clear: "clear(t) — empty a map or zero a slice",
    },
    snippets: [
      { label: "func", body: "func ${name}(${}) ${error} {\n\t${}\n}", detail: "function" },
      { label: "meth", body: "func (${r} *${Type}) ${name}(${}) {\n\t${}\n}", detail: "method" },
      { label: "iferr", body: "if err != nil {\n\treturn ${err}\n}", detail: "if err != nil" },
      { label: "for", body: "for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}", detail: "for loop" },
      { label: "forr", body: "for ${_}, ${v} := range ${xs} {\n\t${}\n}", detail: "for range" },
      { label: "struct", body: "type ${Name} struct {\n\t${}\n}", detail: "struct type" },
      { label: "interface", body: "type ${Name} interface {\n\t${}\n}", detail: "interface type" },
      { label: "main", body: "func main() {\n\t${}\n}", detail: "main function" },
      { label: "test", body: "func Test${Name}(t *testing.T) {\n\t${}\n}", detail: "test function" },
      { label: "go", body: "go func() {\n\t${}\n}()", detail: "goroutine" },
    ],
  },
  cpp: {
    keywords: words(
      "alignas alignof auto break case catch class const constexpr consteval constinit const_cast continue co_await co_return co_yield decltype default delete do dynamic_cast else enum explicit export extern false final for friend goto if inline mutable namespace new noexcept nullptr operator override private protected public register reinterpret_cast return sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union using virtual volatile while #include #define #ifdef #ifndef #endif #pragma",
    ),
    types: [...C_TYPES, ...words("std string vector map unordered_map set unordered_set array optional variant unique_ptr shared_ptr weak_ptr pair tuple function")],
    builtins: {
      printf: "int printf(const char *format, ...) — formatted output to stdout",
      scanf: "int scanf(const char *format, ...)",
      malloc: "void *malloc(size_t size)",
      calloc: "void *calloc(size_t n, size_t size)",
      realloc: "void *realloc(void *ptr, size_t size)",
      free: "void free(void *ptr)",
      memcpy: "void *memcpy(void *dst, const void *src, size_t n)",
      memset: "void *memset(void *dst, int c, size_t n)",
      strlen: "size_t strlen(const char *s)",
      strcmp: "int strcmp(const char *a, const char *b)",
      cout: "std::cout — standard output stream",
      cerr: "std::cerr — standard error stream",
      endl: "std::endl — newline + flush",
      move: "std::move(x) — cast to an rvalue",
      make_unique: "std::make_unique<T>(args…)",
      make_shared: "std::make_shared<T>(args…)",
    },
    snippets: [
      { label: "main", body: "int main(int argc, char *argv[]) {\n\t${}\n\treturn 0;\n}", detail: "main function" },
      { label: "for", body: "for (int ${i} = 0; ${i} < ${n}; ++${i}) {\n\t${}\n}", detail: "for loop" },
      { label: "forr", body: "for (const auto &${x} : ${xs}) {\n\t${}\n}", detail: "range for" },
      { label: "class", body: "class ${Name} {\npublic:\n\t${Name}();\n\t~${Name}();\n\nprivate:\n\t${}\n};", detail: "class" },
      { label: "struct", body: "struct ${Name} {\n\t${}\n};", detail: "struct" },
      { label: "if", body: "if (${cond}) {\n\t${}\n}", detail: "if" },
      { label: "inc", body: "#include <${iostream}>", detail: "#include" },
      { label: "guard", body: "#ifndef ${NAME}_H\n#define ${NAME}_H\n\n${}\n\n#endif", detail: "include guard" },
      { label: "ns", body: "namespace ${name} {\n\n${}\n\n}", detail: "namespace" },
    ],
  },
  java: {
    keywords: words(
      "abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public record return sealed permits static strictfp super switch synchronized this throw throws transient try var void volatile while yield true false null",
    ),
    types: words("boolean byte char short int long float double String Object Integer Long Double Boolean Character List ArrayList Map HashMap Set HashSet Optional Stream Exception RuntimeException"),
    builtins: {
      System: "java.lang.System",
      println: "System.out.println(x) — print with a newline",
      printf: "System.out.printf(format, args…)",
      toString: "String toString()",
      equals: "boolean equals(Object o)",
      hashCode: "int hashCode()",
    },
    snippets: [
      { label: "main", body: "public static void main(String[] args) {\n\t${}\n}", detail: "main method" },
      { label: "sout", body: "System.out.println(${});", detail: "print line" },
      { label: "class", body: "public class ${Name} {\n\t${}\n}", detail: "class" },
      { label: "for", body: "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}", detail: "for loop" },
      { label: "fore", body: "for (${var} ${x} : ${xs}) {\n\t${}\n}", detail: "for each" },
      { label: "try", body: "try {\n\t${}\n} catch (${Exception} e) {\n\t${}\n}", detail: "try / catch" },
      { label: "record", body: "public record ${Name}(${}) {}", detail: "record" },
    ],
  },
  csharp: {
    keywords: words(
      "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield get set init value when where nameof",
    ),
    types: words("String Int32 Int64 Double Boolean Object List Dictionary HashSet IEnumerable Task Action Func Span Exception Console Math"),
    builtins: {
      WriteLine: "Console.WriteLine(value) — print with a newline",
      Write: "Console.Write(value)",
      ReadLine: "Console.ReadLine() -> string?",
      ToString: "string ToString()",
    },
    snippets: [
      { label: "cw", body: "Console.WriteLine(${});", detail: "Console.WriteLine" },
      { label: "class", body: "public class ${Name}\n{\n\t${}\n}", detail: "class" },
      { label: "prop", body: "public ${int} ${Name} { get; set; }", detail: "auto property" },
      { label: "for", body: "for (int ${i} = 0; ${i} < ${n}; ${i}++)\n{\n\t${}\n}", detail: "for loop" },
      { label: "foreach", body: "foreach (var ${x} in ${xs})\n{\n\t${}\n}", detail: "foreach" },
      { label: "try", body: "try\n{\n\t${}\n}\ncatch (${Exception} ex)\n{\n\t${}\n}", detail: "try / catch" },
      { label: "main", body: "static void Main(string[] args)\n{\n\t${}\n}", detail: "Main method" },
    ],
  },
  kotlin: {
    keywords: words(
      "as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg it",
    ),
    types: words("Any Unit Nothing Int Long Short Byte Double Float Boolean Char String Array List MutableList Map MutableMap Set MutableSet Pair Triple"),
    builtins: {
      println: "println(message: Any?) — print with a newline",
      print: "print(message: Any?)",
      listOf: "listOf(vararg elements): List<T>",
      mutableListOf: "mutableListOf(vararg elements): MutableList<T>",
      mapOf: "mapOf(vararg pairs): Map<K, V>",
      setOf: "setOf(vararg elements): Set<T>",
      require: "require(value: Boolean) — throws IllegalArgumentException",
      check: "check(value: Boolean) — throws IllegalStateException",
      lazy: "lazy { … } — lazily initialized value",
      also: "x.also { … } — side effect, returns x",
      apply: "x.apply { … } — configure, returns x",
      let: "x.let { … } — map x",
      run: "x.run { … }",
    },
    snippets: [
      { label: "fun", body: "fun ${name}(${}): ${Unit} {\n\t${}\n}", detail: "function" },
      { label: "main", body: "fun main() {\n\t${}\n}", detail: "main" },
      { label: "data", body: "data class ${Name}(val ${x}: ${Int})", detail: "data class" },
      { label: "when", body: "when (${x}) {\n\t${a} -> ${}\n\telse -> ${}\n}", detail: "when" },
      { label: "for", body: "for (${x} in ${xs}) {\n\t${}\n}", detail: "for loop" },
    ],
  },
  swift: {
    keywords: words(
      "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while as false is nil self Self super throws true try async await actor some any weak unowned lazy mutating override final required convenience",
    ),
    types: words("Int Double Float Bool String Character Array Dictionary Set Optional Result Error Void Any AnyObject"),
    builtins: { print: "print(_ items: Any..., separator:, terminator:)", fatalError: "fatalError(_ message:) -> Never", precondition: "precondition(_ condition:, _ message:)" },
    snippets: [
      { label: "func", body: "func ${name}(${}) -> ${Void} {\n\t${}\n}", detail: "function" },
      { label: "struct", body: "struct ${Name} {\n\t${}\n}", detail: "struct" },
      { label: "class", body: "class ${Name} {\n\tinit() {\n\t\t${}\n\t}\n}", detail: "class" },
      { label: "guard", body: "guard let ${x} = ${expr} else {\n\treturn\n}", detail: "guard let" },
      { label: "iflet", body: "if let ${x} = ${expr} {\n\t${}\n}", detail: "if let" },
    ],
  },
  dart: {
    keywords: words(
      "abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield",
    ),
    types: words("int double num bool String List Map Set Future Stream Object dynamic Iterable Duration DateTime Widget"),
    builtins: { print: "print(Object? object)" },
    snippets: [
      { label: "main", body: "void main() {\n\t${}\n}", detail: "main" },
      { label: "class", body: "class ${Name} {\n\t${}\n}", detail: "class" },
      { label: "stless", body: "class ${Name} extends StatelessWidget {\n\tconst ${Name}({super.key});\n\n\t@override\n\tWidget build(BuildContext context) {\n\t\treturn ${Container()};\n\t}\n}", detail: "StatelessWidget" },
    ],
  },
  scala: {
    keywords: words("abstract case catch class def do else enum export extends false final finally for forSome given if implicit import lazy match new null object override package private protected return sealed super then this throw trait true try type using val var while with yield"),
    types: words("Int Long Double Float Boolean Char String Unit Any AnyRef Nothing List Seq Vector Map Set Option Some None Either Left Right Future"),
    builtins: { println: "println(x: Any)" },
    snippets: [
      { label: "def", body: "def ${name}(${}): ${Unit} =\n\t${}", detail: "method" },
      { label: "main", body: "@main def ${run}(): Unit =\n\t${}", detail: "main" },
      { label: "case", body: "case class ${Name}(${})", detail: "case class" },
    ],
  },
  php: {
    keywords: words(
      "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null self parent",
    ),
    builtins: {
      strlen: "strlen(string $string): int",
      count: "count(Countable|array $value): int",
      array_map: "array_map(?callable $callback, array $array, array ...$arrays): array",
      array_filter: "array_filter(array $array, ?callable $callback = null): array",
      array_keys: "array_keys(array $array): array",
      in_array: "in_array(mixed $needle, array $haystack, bool $strict = false): bool",
      explode: "explode(string $separator, string $string): array",
      implode: "implode(string $separator, array $array): string",
      json_encode: "json_encode(mixed $value): string|false",
      json_decode: "json_decode(string $json, ?bool $associative = null): mixed",
      var_dump: "var_dump(mixed $value): void",
      sprintf: "sprintf(string $format, mixed ...$values): string",
      str_replace: "str_replace($search, $replace, $subject): string|array",
    },
    snippets: [
      { label: "function", body: "function ${name}(${}): ${void}\n{\n\t${}\n}", detail: "function" },
      { label: "class", body: "class ${Name}\n{\n\tpublic function __construct(${})\n\t{\n\t\t${}\n\t}\n}", detail: "class" },
      { label: "foreach", body: "foreach (${$items} as ${$item}) {\n\t${}\n}", detail: "foreach" },
    ],
  },
  ruby: {
    keywords: words("BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_reader attr_writer attr_accessor private protected public lambda proc"),
    builtins: { puts: "puts(*objects) — print with newlines", print: "print(*objects)", p: "p(obj) — inspect and print", raise: "raise(exception, message)", each: "each { |x| … }", map: "map { |x| … }", select: "select { |x| … }" },
    snippets: [
      { label: "def", body: "def ${name}(${})\n\t${}\nend", detail: "method" },
      { label: "class", body: "class ${Name}\n\tdef initialize(${})\n\t\t${}\n\tend\nend", detail: "class" },
      { label: "each", body: "${items}.each do |${item}|\n\t${}\nend", detail: "each block" },
      { label: "if", body: "if ${cond}\n\t${}\nend", detail: "if" },
    ],
  },
  lua: {
    keywords: words("and break do else elseif end false for function goto if in local nil not or repeat return then true until while self"),
    builtins: {
      print: "print(...) — write to stdout",
      pairs: "pairs(t) — iterate key/value pairs",
      ipairs: "ipairs(t) — iterate array part",
      type: "type(v) -> string",
      tostring: "tostring(v) -> string",
      tonumber: "tonumber(v, base?) -> number?",
      require: "require(modname)",
      pcall: "pcall(f, ...) -> ok, ...",
      error: "error(message, level?)",
      assert: "assert(v, message?)",
      setmetatable: "setmetatable(t, mt) -> t",
      getmetatable: "getmetatable(t)",
      select: "select(n, ...)",
      unpack: "table.unpack(t, i?, j?)",
    },
    snippets: [
      { label: "function", body: "function ${name}(${})\n\t${}\nend", detail: "function" },
      { label: "local", body: "local function ${name}(${})\n\t${}\nend", detail: "local function" },
      { label: "for", body: "for ${i} = 1, ${n} do\n\t${}\nend", detail: "numeric for" },
      { label: "forp", body: "for ${k}, ${v} in pairs(${t}) do\n\t${}\nend", detail: "for pairs" },
      { label: "if", body: "if ${cond} then\n\t${}\nend", detail: "if" },
    ],
  },
  shell: {
    keywords: words("if then else elif fi case esac for select while until do done in function time coproc return exit break continue local export readonly declare unset shift source alias"),
    builtins: {
      echo: "echo [args…] — print arguments",
      printf: "printf format [args…]",
      read: "read [-r] [-p prompt] name — read a line",
      cd: "cd [dir]",
      test: "test expr / [ expr ]",
      set: "set [-euxo pipefail]",
      trap: "trap 'cmd' SIGNAL",
      eval: "eval args",
      exec: "exec cmd",
      getopts: "getopts optstring name",
    },
    snippets: [
      { label: "if", body: "if [[ ${cond} ]]; then\n\t${}\nfi", detail: "if" },
      { label: "for", body: "for ${x} in ${list}; do\n\t${}\ndone", detail: "for" },
      { label: "while", body: "while ${cond}; do\n\t${}\ndone", detail: "while" },
      { label: "case", body: 'case "${var}" in\n\t${pattern})\n\t\t${}\n\t\t;;\n\t*)\n\t\t;;\nesac', detail: "case" },
      { label: "fn", body: "${name}() {\n\t${}\n}", detail: "function" },
      { label: "shebang", body: "#!/usr/bin/env bash\nset -euo pipefail\n\n${}", detail: "bash header" },
    ],
  },
  powershell: {
    keywords: words("begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while $true $false $null $_ $PSItem"),
    builtins: {
      "Write-Host": "Write-Host [-Object] <Object> — write to the host",
      "Write-Output": "Write-Output <PSObject[]>",
      "Get-ChildItem": "Get-ChildItem [-Path] <string[]> — list items (ls, dir)",
      "Get-Content": "Get-Content [-Path] <string[]> — read a file (cat)",
      "Set-Content": "Set-Content [-Path] <string[]> [-Value] <Object[]>",
      "Select-Object": "Select-Object [-Property] <Object[]>",
      "Where-Object": "Where-Object { … } — filter",
      "ForEach-Object": "ForEach-Object { … }",
      "Test-Path": "Test-Path [-Path] <string[]> -> bool",
      "New-Item": "New-Item [-Path] <string[]> -ItemType File|Directory",
      "Remove-Item": "Remove-Item [-Path] <string[]>",
      "Invoke-WebRequest": "Invoke-WebRequest [-Uri] <Uri>",
    },
    snippets: [
      { label: "function", body: "function ${Verb-Noun} {\n\tparam(\n\t\t[string]$${Name}\n\t)\n\t${}\n}", detail: "function" },
      { label: "foreach", body: "foreach ($${item} in $${items}) {\n\t${}\n}", detail: "foreach" },
      { label: "if", body: "if (${cond}) {\n\t${}\n}", detail: "if" },
      { label: "try", body: "try {\n\t${}\n} catch {\n\tWrite-Error $_\n}", detail: "try / catch" },
    ],
  },
  perl: {
    keywords: words("my our local sub package use require if elsif else unless while until for foreach last next redo return do eval print printf say die warn chomp push pop shift unshift keys values defined undef scalar ref bless"),
    snippets: [{ label: "sub", body: "sub ${name} {\n\tmy (${$args}) = @_;\n\t${}\n}", detail: "sub" }],
  },
  r: {
    keywords: words("if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library require return"),
    builtins: { c: "c(...) — combine values", print: "print(x)", paste: "paste(..., sep = ' ')", length: "length(x)", "data.frame": "data.frame(...)", list: "list(...)", sapply: "sapply(X, FUN)", lapply: "lapply(X, FUN)", mean: "mean(x)", sum: "sum(...)" },
    snippets: [{ label: "fun", body: "${name} <- function(${}) {\n\t${}\n}", detail: "function" }],
  },
  haskell: {
    keywords: words("case class data default deriving do else foreign if import in infix infixl infixr instance let module newtype of then type where qualified as hiding"),
    types: words("Int Integer Double Float Bool Char String Maybe Just Nothing Either Left Right IO Monad Functor Show Eq Ord"),
    builtins: { map: "map :: (a -> b) -> [a] -> [b]", filter: "filter :: (a -> Bool) -> [a] -> [a]", foldr: "foldr :: (a -> b -> b) -> b -> [a] -> b", putStrLn: "putStrLn :: String -> IO ()", show: "show :: Show a => a -> String" },
  },
  toml: { keywords: words("true false") },
  yaml: { keywords: words("true false null yes no on off") },
  dockerfile: {
    keywords: words("FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS"),
    snippets: [{ label: "node", body: "FROM node:${20}-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD [\"npm\", \"start\"]", detail: "Node image" }],
  },
  cmake: { keywords: words("cmake_minimum_required project add_executable add_library target_link_libraries target_include_directories target_compile_options set if else elseif endif foreach endforeach function endfunction macro endmacro find_package include option message install") },
  nginx: { keywords: words("server listen server_name location root index proxy_pass proxy_set_header return rewrite try_files include upstream gzip ssl_certificate ssl_certificate_key error_page access_log error_log") },
  sql: { keywords: [] },
};

/** C shares the C++ entry (one language id for both). */
export function vocabFor(langId: string): Vocab | undefined {
  return VOCAB[langId];
}

/** Languages whose CodeMirror package completes keywords/locals itself. */
export const NATIVE_COMPLETION = new Set(["typescript", "tsx", "javascript", "jsx", "python", "css", "html", "sql", "xml", "json", "markdown"]);
