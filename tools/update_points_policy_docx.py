from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.table import _Row
from docx.text.paragraph import Paragraph


SOURCE = Path(r"C:\Users\wepie\Desktop\AI 音频工具积分使用制度 V1.0.docx")
OUTPUT = Path(r"C:\Users\wepie\Desktop\AI 音频工具积分使用制度 V1.1.docx")


def set_paragraph_text(paragraph: Paragraph, text: str) -> None:
    runs = list(paragraph.runs)
    if not runs:
        paragraph.add_run(text)
        return
    runs[0].text = text
    for run in runs[1:]:
        run.text = ""


def set_cell_text(cell, text: str) -> None:
    paragraph = cell.paragraphs[0]
    set_paragraph_text(paragraph, text)
    for extra in cell.paragraphs[1:]:
        set_paragraph_text(extra, "")


def set_row_text(row: _Row, values: list[str]) -> None:
    if len(row.cells) != len(values):
        raise ValueError(f"Expected {len(row.cells)} cells, received {len(values)} values")
    for cell, value in zip(row.cells, values):
        set_cell_text(cell, value)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def find_paragraph(document: Document, text: str) -> Paragraph:
    for paragraph in document.paragraphs:
        if paragraph.text == text:
            return paragraph
    raise ValueError(f"Paragraph not found: {text}")


def clone_paragraph_before(target: Paragraph, source: Paragraph, text: str) -> Paragraph:
    element = deepcopy(source._p)
    target._p.addprevious(element)
    paragraph = Paragraph(element, target._parent)
    set_paragraph_text(paragraph, text)
    return paragraph


def mark_repeat_header(row: _Row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:tblHeader")) is None:
        tr_pr.append(OxmlElement("w:tblHeader"))


def prevent_row_split(row: _Row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def main() -> None:
    document = Document(SOURCE)

    set_paragraph_text(document.paragraphs[0], "AI 音频工具积分使用制度 V1.1")
    set_row_text(document.tables[0].rows[1], [
        "V1.1",
        "补充功能并按月校准",
        "自然月",
        "设置中的积分统计",
    ])

    find_paragraph(document, "下表为 V1.0 建议扣分标准。系统应在提交前显示预计积分，生成完成后再按实际字符、时长、版本数和供应商返回的计费信息结算。")
    set_paragraph_text(
        find_paragraph(document, "下表为 V1.0 建议扣分标准。系统应在提交前显示预计积分，生成完成后再按实际字符、时长、版本数和供应商返回的计费信息结算。"),
        "下表为 V1.1 执行扣分标准。系统在提交前显示预计积分，生成完成后再按实际字符、时长、版本数和供应商返回的计费信息结算。",
    )

    tier_table = document.tables[1]
    set_cell_text(tier_table.rows[2].cells[2], "音效、买量广告、音频、视频、配音及高频制作人员")

    function_table = document.tables[2]
    set_row_text(function_table.rows[6], [
        "人声提取 ElevenLabs",
        "源音频时长",
        "120 分 每分钟",
        "单版",
        "120 分 每分钟",
    ])
    set_row_text(function_table.rows[7], [
        "语音转文字与语言识别",
        "源音频时长",
        "36 分 每分钟",
        "单次识别",
        "36 分 每分钟",
    ])
    set_row_text(function_table.rows[9], [
        "本地音频处理",
        "公司 CPU 或 GPU 运算",
        "暂不扣 API 积分",
        "按实际任务",
        "0 分",
    ])

    local_row = function_table.rows[9]
    token_row_element = deepcopy(local_row._tr)
    local_row._tr.addprevious(token_row_element)
    set_row_text(_Row(token_row_element, function_table), [
        "GPT 文本与视觉辅助",
        "实际输入输出 Token",
        "输入 2 分每千 Token；输出 10 分每千 Token",
        "单次调用",
        "按 Token 结算；每次至少 1 分",
    ])
    audio_token_row_element = deepcopy(local_row._tr)
    local_row._tr.addprevious(audio_token_row_element)
    set_row_text(_Row(audio_token_row_element, function_table), [
        "GPT 音频分析",
        "实际音频模型 Token",
        "输入 10 分每千 Token；输出 20 分每千 Token",
        "单次分析",
        "按 Token 结算；每次至少 10 分",
    ])

    example_table = document.tables[3]
    set_row_text(example_table.rows[6], [
        "语音转文字 20 秒",
        "单次",
        "12 分",
        "按 36 分每分钟折算",
    ])
    set_row_text(example_table.rows[7], [
        "Dubbing v2 20 秒",
        "单版单语种",
        "约 733 分",
        "第二个目标语种再次按源时长计费",
    ])

    capacity_table = document.tables[4]
    set_row_text(capacity_table.rows[1], [
        "基础档 5,000",
        "约 250 次",
        "约 33 次",
        "约 125 次",
        "约 62 次",
        "约 6 次",
    ])
    set_row_text(capacity_table.rows[2], [
        "专业档 20,000",
        "约 1,000 次",
        "约 133 次",
        "约 500 次",
        "约 250 次",
        "约 27 次",
    ])

    set_paragraph_text(
        find_paragraph(document, "本地方案的生成阶段暂不扣 API 积分；若调用 Scribe 识别或 Gemini 翻译，相关费用仍按实际扣除。"),
        "本地方案的生成阶段暂不扣 API 积分；若调用 Scribe 识别或 GPT 等模型翻译，相关费用仍按各自规则扣除。",
    )

    old_six = find_paragraph(document, "六 档位可用量参考")
    old_seven = find_paragraph(document, "七 部门项目池")
    old_eight = find_paragraph(document, "八 积分不足和追加规则")
    old_nine = find_paragraph(document, "九 推荐使用流程")
    old_ten = find_paragraph(document, "十 管理员统计和复盘")
    old_eleven = find_paragraph(document, "十一 价格校准和调整")

    heading_source = find_paragraph(document, "五 跨语种转换规则")
    body_source = find_paragraph(document, "跨语种功能分为本地方案和 ElevenLabs Dubbing v2。日常试验与内部预览优先使用本地模型；需要保留多人声线、情绪、节奏和背景混音的正式交付，再使用 Dubbing v2。")
    bullet_source = find_paragraph(document, "20 秒以内：个人余额充足时可直接使用，但生成前必须显示预计积分。")

    clone_paragraph_before(old_six, heading_source, "六 复合功能与 Token 计费")
    clone_paragraph_before(
        old_six,
        body_source,
        "新增的智能分析与辅助功能按实际 Token 成本结算，不设置固定单次分值。系统记录功能、模型、输入 Token、输出 Token、推理 Token 和公司积分，便于按人员与功能复盘。",
    )
    clone_paragraph_before(
        old_six,
        bullet_source,
        "Token 类功能包括：智能助手任务规划与执行、AI 音频设计、视频声音分析、音效需求表、歌词生成与改写、音乐提示词优化、文本翻译、声音匹配、台词增强、图片台词识别、音效库元数据优化、音频分析和音乐分析命名。",
    )
    clone_paragraph_before(
        old_six,
        bullet_source,
        "智能助手先产生规划调用，随后若继续生成配音、音乐或音效，下游生成按对应功能再次计费；仅搜索本地音效库、编辑参数或执行本地处理时，不产生 API 积分。",
    )
    clone_paragraph_before(
        old_six,
        bullet_source,
        "视频声音制作按步骤累计：画面分析按 Token 结算，配音按字符结算，音乐和音效按输出时长及版本数结算；一键生成全部片段时，各片段积分相加。",
    )
    clone_paragraph_before(
        old_six,
        bullet_source,
        "音频分析先在本机提取波形、节拍、调性等指标；本地指标提取不扣 API 积分，调用 GPT 进行语义分析或听音分析时按实际 Token 结算。",
    )
    clone_paragraph_before(
        old_six,
        bullet_source,
        "本地 0 API 积分功能包括：音频解码与格式转换、混音与导出、音频转 MIDI、本地人声分离、高质量音乐分轨、本地声音克隆和本地变声。后续如改用云端模型，须在上线前补充计费规则。",
    )
    clone_paragraph_before(
        old_six,
        body_source,
        "当前执行状态：Token 类功能已纳入个人积分。文本与视觉模型试运行基准为输入 2 分每千 Token、输出 10 分每千 Token，每次成功调用至少 1 分；原生 GPT 听音分析为输入 10 分每千 Token、输出 20 分每千 Token，每次成功调用至少 10 分。正式服务器配置实际供应商单价后覆盖试运行基准，并按月校准。",
    )

    set_paragraph_text(old_six, "七 档位可用量参考")
    set_paragraph_text(old_seven, "八 部门项目池")
    set_paragraph_text(old_eight, "九 积分不足和追加规则")
    set_paragraph_text(old_nine, "十 推荐使用流程")
    set_paragraph_text(old_ten, "十一 管理员统计和复盘")
    set_paragraph_text(old_eleven, "十二 价格校准和调整")

    set_paragraph_text(
        find_paragraph(document, "管理员统计页应支持按人员、部门、功能、模型和日期查看数据，并显示公司积分、原始字符或分钟、Gemini 和 GPT token、生成版本数、项目池来源及追加记录。设置页继续使用管理员密码保护；正式上线后以飞书用户身份作为人员统计依据。"),
        "管理员统计页支持按人员、部门、功能、模型和日期查看数据，并显示公司积分、ElevenLabs 原始 credits、字符或分钟、GPT 等模型的 Token、生成版本数、项目池来源及追加记录。设置页继续使用管理员密码保护；正式上线后以飞书用户身份作为人员统计依据。",
    )
    set_paragraph_text(
        find_paragraph(document, "每月底根据 ElevenLabs、Gemini 和 GPT 实际账单校准一次积分价格。"),
        "每月底根据 ElevenLabs、GPT 及当前实际接入供应商的账单校准一次积分价格。",
    )
    set_paragraph_text(find_paragraph(document, "附录 V1.0 价格基准"), "附录 V1.1 执行基准")
    set_paragraph_text(
        find_paragraph(document, "本版 ElevenLabs 价格基准核对日期为 2026 年 9 月。官方 API 页面显示：标准 TTS 每千字符 0.10 美元，Flash 或 Turbo 每千字符 0.05 美元，Scribe v2 每小时 0.22 美元，Music 每分钟 0.15 美元，Voice Changer、Voice Isolator 和 Sound Effects 每分钟 0.12 美元，Dubbing v2 每分钟 2.20 美元。供应商价格不含税费。"),
        "V1.1 沿用 2026 年 9 月核对的 ElevenLabs 价格基准：标准 TTS 每千字符 0.10 美元，Flash 或 Turbo 每千字符 0.05 美元，Scribe v2 每小时 0.22 美元，Music 每分钟 0.15 美元，Voice Changer、Voice Isolator 和 Sound Effects 每分钟 0.12 美元，Dubbing v2 每分钟 2.20 美元。供应商价格不含税费。Token 类模型先执行 V1.1 试运行基准，正式服务器取得实际采购单价后覆盖并在月末校准。",
    )

    for table in document.tables:
        mark_repeat_header(table.rows[0])
        for row in table.rows:
            prevent_row_split(row)
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.keep_together = True

    heading_texts = {
        "制度说明",
        "一 积分定义和基本原则",
        "二 月度积分档位",
        "三 功能积分规则",
        "四 常见操作扣分示例",
        "五 跨语种转换规则",
        "六 复合功能与 Token 计费",
        "七 档位可用量参考",
        "八 部门项目池",
        "九 积分不足和追加规则",
        "十 推荐使用流程",
        "十一 管理员统计和复盘",
        "十二 价格校准和调整",
        "附录 V1.1 执行基准",
        "普通配音 音效和音乐",
        "跨语种转换",
    }
    for paragraph in document.paragraphs:
        if paragraph.text in heading_texts:
            paragraph.paragraph_format.keep_with_next = True

    document.core_properties.title = "AI 音频工具积分使用制度 V1.1"
    document.core_properties.subject = "公司内部 AI 音频工具积分规则"
    document.core_properties.comments = "V1.1 补充复合功能、Token 计费和本地处理边界，并校正示例数据。"
    document.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
