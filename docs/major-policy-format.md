# 专业规则文件 v1

普通文件上传入口接受 `.json`，格式必须是 `gongkao-major-policy`。资料包备份与来源目录 JSON 使用各自入口，不能混用。

完整可运行的虚构例子见 [fictional-major-policy.json](../examples/fictional-major-policy.json)。与 [虚构岗位表](../examples/江苏2099虚构岗位.csv) 一起上传，填写本科、专业“示例纺织工程”：示例工程类岗位命中，示例法学岗位不命中。示例无真实报考效力。

| 字段 | 要求 |
|---|---|
| `format` / `version` | `gongkao-major-policy` / `1` |
| `context` | 明确的 `province`、四位 `year`、`examType`，与资料包完全一致 |
| `strategy` | `hierarchy`、`enumeration` 或 `exact` |
| `source` | 原文件 `title` 及公开 HTTP/HTTPS `url`；不会自动访问或验证该链接 |
| `nodes` | 最多 20,000 项；唯一 `id`、`name`、`education`、`kind`，可选 `code`、`aliases` |
| `edges` | 最多 50,000 项；`parent`、`child`、`evidence: {text, location}` |

节点 `kind` 是 `category` 或 `major`。学历为大专、本科、硕士、博士或研究生；研究生节点可供硕士/博士选择，但关系边两端的学历字段必须相同。专业别名只应收录原文明确对应的旧名等，不应把“相近专业”擅自加入别名。

层级关系的父节点只能是类别；枚举关系的子节点只能是具体专业；精确策略的 `edges` 必须为空。禁止循环、同学历重复专业名和重复代码。运行时遇到名称或别名歧义、个人名称与代码矛盾、未知岗位范围，均待核对。

岗位中并列专业使用逗号、分号、顿号等分隔。任一明确允许项命中即可；带“方向”“不含”“限：”等附加限定的文本保留待核对。复杂自然语言不会自动拆成可靠规则。

当前规则文件由人工核对后整理。上传普通官方目录文件只表示读取资料，不表示已自动提取成可执行的专业关系。PHP/JavaScript/Python 表达式等不会作为规则执行。
