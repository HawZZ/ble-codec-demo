# 物模型与BLE映射：两个JSON即可接入

版本：0.2评审（2026-11-03）  
状态：统一交换契约的评审文档。本版不替换已发布0.6.1，也不修改旧冻结材料。文档定义、离线验证、Demo部署和真实设备验收分别记录；Demo入口为 https://hawzz.github.io/ble-codec-demo/ 。

本说明约定产品接入时日常交付的两个JSON。它描述基于原产品报文的业务模型和线地址映射，不把现有设备报文改成统一的读、写、动作CID，也不声明兼容任意云平台的物模型格式或原生TSL。

## 日常维护与机器文件的区别

Demo默认按属性／事件／服务三个标签表格维护物模型，并保留结构树和JSON视图。指令表只展示物模型功能、SID、CID、交互及操作；字段表按当前指令和上下行展示业务字段、TLV地址、线上类型、是否必带及操作。

内部指令ID由系统生成且保持稳定；格式、版本、模型引用和能力声明不要求人工填写。来源和备注作为说明；关联限制及已有超时只读保留。倍率1、数值偏移0无需重复配置；固定类型字节宽度自动确定。高级详情继续保留变长字节限制、成功码、上行属性更新和组合约束。业务范围、工程值步长与枚举不能只写在说明中，线上类型也不能只凭物模型类型推断。

界面收起字段不意味着从机器文件删除语义。既有两文件、CSV、工作区及高级元数据仍按下文契约读写；维护入口的简化不删除语义；本轮增补platformType及能力校验，格式标识、地址及报文字节不变。通过表格或结构树重命名会更新明确关联的引用；直接编辑JSON须校验现有映射，失败不替换有效模型。

## 1. 唯一交换格式与权威定义

| 文件 | 主要格式 | 规范性Schema | 责任 |
| --- | --- | --- | --- |
| `thing-model.json` | `thing-model-definition/1.0`；也兼容无元数据的旧裸模型 | [`thing-model-definition.schema.json`](schemas/thing-model-definition.schema.json) | 属性、服务、事件、业务权限和数值约束 |
| `ble-mapping.json` | `ble-thing-mapping/1` | [`ble-thing-mapping.schema.json`](schemas/ble-thing-mapping.schema.json) | 原SID/CID、请求/入站字段、TLV地址、线类型和交互 |

唯一正式映射格式是`ble-thing-mapping/1`。不另设第三种业务定义格式，也不把模型和映射再拆成用户需要同时维护的多个文件。CSV、workspace、完整机器字典和fixtures分别是批量视图、编辑备份、编译缓存和研发验算材料，不是日常必交定义。`provenance`和`identity`只保存系统来源与身份说明，不能承载新的执行语义。

`supporting/ble-app-protocol-mapping.schema.json`描述内部编译缓存`ble-model-mapping/0.2`，不是用户交付契约。缓存可以带`exchange: {model, mapping}`保存同一对规范来源，加载时重新导入并检查缓存中的物模型、地址、字段布局和组约束；该对象由工具生成，不是第三份日常文件。

系统导出的正式文件自动生成`modelRef`和`requiredCapabilities`。普通产品配置人员不需要手填这两个字段，也不能删除它们绕过两文件配套校验。模型带`id`或`version`时，映射必须引用相同的ID和版本；内容SHA必须匹配。

`tools/ble_two_file.py`调用与Demo相同的导入、校验和编译路径：

```sh
python3 tools/ble_two_file.py \
  --model /path/to/thing-model.json \
  --mapping /path/to/ble-mapping.json
```

需要生成统一格式时增加`--normalized-output <目录>`，工具写出`thing-model.json`和`ble-mapping.json`。CLI只做离线定义校验和编译，不连接真实BLE，也不执行平台写入。

## 2. 物模型定义业务

物模型根节点包含`properties`、`services`、`events`三个对象。旧文件可用`methods`代替`services`，但二者不能同时出现；不带系统元数据的旧裸模型只在明确兼容路径中接受。

新模型可以携带以下顶层元数据：

- `format: "thing-model-definition/1.0"`、`id`、`version`、`name`、`description`；
- `schema_dialect`、`numeric_step_defaults`和`notes`。

`numeric_step_defaults`可给`integer`和`number`声明默认`multipleOf`，并固定`explicit_constraint_takes_precedence: true`。字段已声明的`multipleOf`优先于默认步长；系统不会用取整放宽该约束。

平台／APP的物模型类型为`object`、`array`、`Int32`、`Float`、`Double`、`Enum`、`Bool`和`String`。BLE映射的`wireType`独立表达线上编码，不要求两者名称、宽度或类型一一相同。例如物模型Int32的温度0～100可以用BLE u8传输；25的TLV为`01 01 19`，Value仍为1B，不因平台使用Int32扩成4B。Int32的业务值还须处于−2147483648～2147483647内；线编码u32的完整值域不能直接视为Int32值域。

节点新增`platformType`保存平台选择；JSON Schema的`type`由系统生成：Int32→integer、Float／Double→number、Bool→boolean、String→string、object／array保持原名。Enum必须有非空enum，允许同类型Int32整数或字符串，对应integer或string。维护者不重复填写两种类型；wireType继续在映射中独立配置。未知平台类型或不一致的type拒绝。

```json
{"type":"integer","platformType":"Int32","access":"rw","minimum":0,"maximum":100,"multipleOf":1}
```

使用platformType必须由系统声明`platform-types/1`能力；类型参与模型SHA和属性投影一致性检查，不能把Float与Double合并为未区分的number。不支持能力、漏报能力或两文件错配均拒绝。旧文件缺少platformType时保持原义，不自动猜测或补类型；新增语义不能通过删除系统引用进入旧裸模型兼容路径。两文件format保持不变，旧消费者应按能力声明拒绝新语义。

Int32校验有符号32位整数值域；Float校验单精度有限范围，拒绝非零值下溢为0；Double校验双精度有限范围。模型声明范围、枚举和实际数据都适用。工程值及范围／步长／精确逆换算先按既有规则校验，禁止提前舍入放宽限制。浮点线编码f32／f64按报文实际值换算，不能把近似值恢复成猜测的小数；例如f32的0.1会得到约0.10000000149，若模型要求精确步长0.1则拒绝。需要严格十进制步长时应采用兼容的整数线值与倍率。JSON输出保存工程值，平台存储按所选Float／Double精度转换时可能舍入；Demo不模拟数据库存储，不承诺Float与Double具有相同有效精度。

JSON子集继续支持properties、items、required、additionalProperties=false、minimum／maximum、multipleOf、enum、数组／字符串长度、title／description、format: "hex"和属性access。对象和数组内的每级节点也可保存platformType；旧约束和线上字节规则不变。

服务声明`input`和`output`两个节点，可按产品定义增加`availability: "active" | "suspended"`。事件声明其上行数据节点。业务范围、枚举、步长、必填和结构约束在物模型维护，SID/CID、TLV路径和线宽只在映射维护。

属性的`rw`只表示业务权限，不能推导设备真的存在读CID、写CID、响应内容、成功码或完成条件。服务有独立操作含义，事件表示通知；基础属性可直接映射，不需要为每个属性新增服务。

## 3. 映射定义报文地址与交互

正式映射根节点必须包含`format`、`commands`、`modelRef`和`requiredCapabilities`。`commands`为非空数组，每条指令采用平铺结构：

| 字段 | 含义 |
| --- | --- |
| `id` | 指令唯一英文标识符 |
| `sid`、`cid` | 产品原有应用地址，HEX字符串；不得借映射重新分配地址 |
| `target` | `property`、`service`或`event`及模型标识 |
| `interaction` | `request_response`、`query_and_report`、`one_way`或`receive_only` |
| `receiveVariants` | 明确列出`incoming`、`result`、`empty`中的适用项；没有应用回包时为空数组 |
| `request`、`incoming` | 下行请求和上行入站数据的平铺字段映射 |
| `constraints` | 已确认的`at_least_one`或`all_or_none`组约束 |
| `propertyUpdates`、`resultSuccessCode`、`notes` | 可选的上行业务属性投影、来源确认的成功码和说明 |
| `correlation`、`timeoutMs`、`source`、`availability` | 关联方式、已确认时限、来源和启停状态 |

`target.kind=property`时必须填写`behavior`：读取用`read`，设置用`write`，上报用`report`。服务只引用服务名，事件只引用事件名，二者不再声明`behavior`。属性读/写/报必须分别由真实指令建立；权限不匹配、模型引用不存在或映射把停用服务改成启用均拒绝。

`request`和`incoming`中的每项至少包含`field`、`tlv`、`wireType`：

- `field`是相对于`target`作用域的模型数据路径，支持嵌套对象和数组路径，例如`pump_status_list[].pump_level`；
- `tlv`是逻辑Type路径，例如`01/02/03`；容器内容中的bit7不写进路径；
- `wireType`声明线上编码，支持布尔、UTF-8、字节串、整数/浮点及数字数组、对象、数组、重复对象和分组；
- `required`默认`true`；`scale`和`offset`用于精确数值换算；变长字段用`maxBytes`；固定宽度字段可写`length`作一致性校验，宽度不一致时拒绝。

数值换算固定为`模型值 = 线值 × scale + offset`，反向编码为`(模型值 - offset) / scale`。结果必须精确符合物模型，不能通过取整接受非法业务值。消息长度上限`maxBytes`只约束字段值，完整应用PDU仍受2048B上限约束。

`constraints[].fields`的每一项只能是一个英文字段标识符，不能把多个字段用`|`拼成单项。数组元素路径的`[]`只用于`field`和模型结构，不可用于`propertyUpdates.from`。

## 4. 上行属性更新与结果语义

`propertyUpdates`把本次上行数据中的值投影为物模型顶层属性patch，格式为：

```json
{"from": "上行数据对象中的路径", "to": "顶层属性名"}
```

约束如下：

1. 只允许用于声明了`incoming`的上行数据，不能由请求、结果码或空回包生成业务属性。
2. `from`是相对于入站数据对象的对象字段路径，可嵌套；不得跨越或选中某个数组元素，不得出现`[]`。数组只能整体投影。
3. `to`必须是已存在的顶层属性，同一指令内不能重复；只写属性不能作为更新目标。
4. 来源和目标在忽略标题、说明、权限等注解后的数据类型及业务约束必须完全一致，否则拒绝。
5. 缺失来源字段时不生成该属性patch；该声明不表达删除、置空或继承旧值。
6. 服务输出和事件可以同时产生自身数据与属性patch；属性映射可直接产生属性数据。
7. 数组整体投影只表示本次patch携带了收到的数组。按`side`等业务身份合并到当前状态仍待产品确认；当前契约不承诺按索引合并或直接替换云侧当前态。

`resultSuccessCode`只在产品来源明确给出成功值且指令声明`result`时填写。本批Pump来源定义的成功码为十进制`100000`，公共结果组件仍为`7F/04/u32`。没有来源时省略，不把`0`、空回包或其他返回值推定为成功。匹配成功码只说明结果码等于来源声明，不说明设备动作已经完成。

结果码和空包是协议元数据，不生成业务属性或事件。`query_and_report`只把收到的数据标为`response_or_report`；在没有请求标识或可验证时序保证时，不能声称它匹配了某次查询，也不能据此去重或只执行一次。

`correlation`只能表达当前已知的`none`或`unmarked`。`timeoutMs`只在产品资料明确时填写，不设默认5000ms；本标准不补造消息号、异步任务、重试或完成机制。

## 5. 模型引用、能力与内容哈希

映射中的`modelRef`由导出器生成：

```json
{
  "modelRef": {
    "id": "产品模型ID",
    "version": "模型版本",
    "sha256": "64位小写十六进制"
  },
  "requiredCapabilities": [
    "model-reference/1",
    "tlv-length-1-2/1"
  ]
}
```

模型带ID或版本时，`modelRef`必须同时带上相同的ID和版本。消费者重新计算模型内容SHA，并拒绝两文件不配套的组合。

`requiredCapabilities`由模型和映射实际使用能力计算，至少包括`model-reference/1`和`tlv-length-1-2/1`。使用属性更新、嵌套TLV、纯上行、重复对象、结果成功码或数值默认步长时，还必须分别声明`property-updates/1`、`nested-tlv/1`、`receive-only/1`、`repeated-object/1`、`result-success-code/1`或`numeric-defaults/1`。模型包含platformType时还须声明`platform-types/1`；消费者拒绝未知能力和漏报能力。

模型内容SHA256采用本项目`model-content v1`算法：

1. 递归处理JSON值；对象键按Unicode码点排序，数组保持顺序。
2. 字符串使用`ensure_ascii=False`的JSON字符串表示，保留Unicode原文，并按JSON规则转义引号、反斜杠和控制字符。
3. 布尔和`null`使用常规JSON字面量；数字先按`Decimal(str(value))`读取，再展开为无指数十进制，删除小数末尾的0，负零写为`0`。
4. 对象和数组不写额外空格，最终用UTF-8编码并计算SHA256。

因此缩进、换行、对象键序以及`1`和`1.0`的写法不影响结果。该算法是本项目契约定版，不宣称为RFC 8785或其等价实现。

## 6. 示例：服务输出同时更新属性

下面的一对文件是合成教学定义，不是真实设备CID。属性名和输出字段故意相同，用于展示服务输出到顶层属性的投影；`modelRef`和`requiredCapabilities`展示系统导出结果，日常维护者不手填。

物模型：

```json
{
  "format": "thing-model-definition/1.0",
  "id": "level-demo",
  "version": "1",
  "properties": {
    "level": {
      "type": "integer",
      "access": "r",
      "minimum": 0,
      "maximum": 10,
      "multipleOf": 1
    }
  },
  "services": {
    "read_level": {
      "input": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "output": {
        "type": "object",
        "properties": {
          "level": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10,
            "multipleOf": 1
          }
        },
        "required": ["level"],
        "additionalProperties": false
      }
    }
  },
  "events": {}
}
```

映射：

```json
{
  "format": "ble-thing-mapping/1",
  "commands": [
    {
      "id": "read_level",
      "sid": "80",
      "cid": "01",
      "target": {
        "kind": "service",
        "identifier": "read_level"
      },
      "interaction": "request_response",
      "receiveVariants": ["incoming"],
      "incoming": [
        {
          "field": "level",
          "tlv": "01",
          "wireType": "u8",
          "required": true
        }
      ],
      "propertyUpdates": [
        {"from": "level", "to": "level"}
      ],
      "source": "合成教学示例，不是真实设备定义"
    }
  ],
  "modelRef": {
    "id": "level-demo",
    "version": "1",
    "sha256": "f02e14469d8aa7f885f1a507ed3a0e095a79ea45b3f2bf9ed8a744bef088c95d"
  },
  "requiredCapabilities": [
    "model-reference/1",
    "property-updates/1",
    "tlv-length-1-2/1"
  ]
}
```

收到应用PDU`80 01 01 01 05`时，入站布局数据为`{"level":5}`；物模型补丁同时包含服务输出`{"read_level":{"output":{"level":5}}}`和属性`{"level":5}`。它不说明某次请求已被精确匹配，也没有保存或合并完整设备状态。

八类型合成样例位于`examples/ble-codec-demo/platform-types/`，可在Demo选择“平台类型 · 八种类型”，含Int32/u8、整数倍率到Float／Double、Enum、Bool、String、数组和嵌套。以下旧温度样例保留未声明平台类型的兼容路径。

合成温度样例位于[`examples/ble-codec-demo/temperature.thing-model.json`](samples/temperature/thing-model.json)和[`temperature.ble-mapping.json`](samples/temperature/ble-mapping.json)，只映射一个属性，没有新增服务。完整Pump样例位于[`examples/ble-codec-demo/pump/`](samples/pump/thing-model.json)。样例存在不等于固件实现、实机报文或平台能力已经验收。

## 7. 转换结果接口

Demo和CLI共用同一导入/编译路径。转换API同时返回：

- `model_json`：按当前指令角色解码或编码得到的布局数据，用于检查TLV到模型作用域的直接结果；
- `thing_model_json`：形如`{"properties":{},"services":{},"events":{}}`的本次物模型patch，服务项带`input`或`output`；
- `metadata`：消息类别、结果码、成功码匹配、`exact_request_match`和`auto_complete`等限制。

`thing_model_json`只表示一次转换产生的数据。它不是完整物模型状态、数据库当前值、云平台原生TSL或设备执行结果。结果码或空包时，三个业务集合为空。Demo界面展示`thing_model_json`；`model_json`仍保留在API结果中供布局验算。

## 8. 兼容与迁移

导入按一对文件整体处理。读取全部JSON、Schema、引用、能力、字段、地址冲突、组约束和属性Update后，成功才替换工作区；任一检查失败均保留原工作区。

正式`ble-thing-mapping/1`必须有系统生成的`modelRef`和`requiredCapabilities`，且引用和能力不得缺漏。未知格式、未知能力、未知字段、冲突引用或语义不匹配均拒绝。

仅以下旧组合走明确本地兼容迁移：无`format`、`id`、`version`及任何模型元数据的旧裸模型，配只有`format: "ble-thing-mapping/1"`、`commands`和可选`identity`的旧平铺映射，且指令不含`propertyUpdates`、`resultSuccessCode`、`notes`等新元数据。工具在内存中补`modelRef`、`requiredCapabilities`和兼容provenance；新语义文件不能通过删引用或漏报能力进入。

2026-11-03交付的拆分定义`ble-mapping-definition/1.0`只接受已登记结构：

1. 校验物模型格式、ID、版本，以及映射`thing_model_sha256`与旧模型原文（去除开头BOM后的UTF-8字节）的SHA256。
2. 只接受已登记的`common`内容，其canonical内容SHA须为`c069e9eee21fa007c436f2d08c488ba73d29370740b5325baa0b50e57a24eb6e`；任何PDU、TLV、交互、空包、关联、属性更新或启停语义声明变化均拒绝。
3. 逐条解析所有`schema_ref`、服务/事件目标、地址帧头、`model_path_base`、父级作用域、`logical_path`、`wire_path`、`wire_type_byte`、字段key、固定字节长度和属性目标。
4. 把旧`common`和模型引用保存到`provenance.sourceDefinitionMetadata`，将已知结构转换为统一平铺命令，不复用旧嵌套布局作为日常格式。
5. 导出只生成`ble-thing-mapping/1`两文件；迁移后`modelRef.sha256`改用统一模型内容哈希。

未知拆分结构、旧原文SHA不符、引用不一致或派生Type信息矛盾均拒绝。迁移失败不修改工作区。

## 9. 不变的报文与交付边界

本约定不改变设备应用层报文：保留产品原SID/CID和报文字节。业务SID范围、公共结果组件和公共能力边界沿主标准；映射Schema只校验地址可表示为HEX，不代表编号登记、品类批准或固件实现已经完成。

TLV Length仍为1～2B，数值按高7位在前、低7位在后编码，最多支持16383B的Value长度；完整应用PDU上限仍为2048B。Type的bit7表示容器，不允许用猜测解析未知结构。R5仍不兼容，加密方案仍待定。

本批不实现真实APP SDK、平台下发、云端状态合并、真实BLE/GATT或固件执行。旧发布0.6.1、平台原型和冻结附件保持原状；Schema、CLI、Demo及发布回读的验收结果见项目发布记录；它们不替代真实设备或生产平台验收。
