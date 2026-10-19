#!/usr/bin/env python3
"""Build a native direct-upload shortcut from a redacted, exported workflow."""

import argparse
import copy
import pathlib
import plistlib
import uuid


def uid():
    return str(uuid.uuid4()).upper()


def variable(name):
    return {"Type": "Variable", "VariableName": name}


def attachment(value):
    return {"WFSerializationType": "WFTextTokenAttachment", "Value": value}


def text(*parts):
    value = ""
    ranges = {}
    for part in parts:
        if isinstance(part, dict):
            offset = len(value.encode("utf-16-le")) // 2
            ranges[f"{{{offset}, 1}}"] = part
            value += "\ufffc"
        else:
            value += part
    result = {"string": value}
    if ranges:
        result["attachmentsByRange"] = ranges
    return {"WFSerializationType": "WFTextTokenString", "Value": result}


def dictionary(fields):
    items = []
    for key, value in fields.items():
        if isinstance(value, list):
            item_type = 2
            children = [
                {
                    "WFItemType": 1,
                    "WFValue": {
                        "WFSerializationType": "WFDictionaryFieldValue",
                        "Value": dictionary(child),
                    },
                }
                for child in value
            ]
            state = {"WFSerializationType": "WFArrayParameterState", "Value": children}
        else:
            item_type = 0
            state = text(value)
        items.append({"WFItemType": item_type, "WFKey": text(key), "WFValue": state})
    return {
        "WFSerializationType": "WFDictionaryFieldValue",
        "Value": {"WFDictionaryFieldValueItems": items},
    }


class Workflow:
    def __init__(self):
        self.actions = []

    def add(self, name, **params):
        action_id = uid()
        self.actions.append({
            "WFWorkflowActionIdentifier": "is.workflow.actions." + name,
            "WFWorkflowActionParameters": {"UUID": action_id, **params},
        })
        return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": name}

    def assign(self, name, source, append=False):
        return self.add(
            "appendvariable" if append else "setvariable",
            WFVariableName=name, WFInput=attachment(source),
        )

    def condition(self, source, condition=100):
        group = uid()
        self.add(
            "conditional", GroupingIdentifier=group, WFControlFlowMode=0,
            WFCondition=condition,
            WFInput={"Type": "Variable", "Variable": attachment(source)},
        )
        return group

    def close(self, group, otherwise=False, repeat=False):
        return self.add(
            "repeat.each" if repeat else "conditional",
            GroupingIdentifier=group, WFControlFlowMode=1 if otherwise else 2,
        )

    def value(self, source, key):
        return self.add("getvalueforkey", WFInput=attachment(source), WFDictionaryKey=key)

    def fail_if_error(self, source, stage):
        error = self.value(source, "error")
        group = self.condition(error)
        self.add("alert", WFAlertActionTitle=stage, WFAlertActionMessage=text(error))
        self.add("exit")
        self.close(group)

    def post(self, url, body):
        return self.add(
            "downloadurl", WFURL=url, WFHTTPMethod="POST", ShowHeaders=True,
            WFHTTPBodyType="JSON", WFJSONValues=dictionary(body),
            WFHTTPHeaders=dictionary({"Authorization": text_auth()}),
        )


def text_auth():
    # The enclosing dictionary helper accepts token strings as values.
    return {"Type": "Variable", "VariableName": "Authorization"}


def build(template, base, smoke, offline=False):
    workflow = copy.deepcopy(template)
    original = template["WFWorkflowActions"]
    w = Workflow()
    if offline:
        first = w.add("dictionary", WFItems=dictionary({"key": "media/0123456789ab.mp4", "name": "test.mp4", "mime": "video/mp4"}))
        w.assign("已传媒体", first, append=True)
        body = w.add("dictionary", WFItems=dictionary({
            "text": 'Quotation " and newline\nUnicode 中文',
            "fixed": [{"key": "media/0123456789ab.mp4", "name": "test.mp4", "mime": "video/mp4"}],
        }))
        single = w.add("setvalueforkey", WFDictionary=attachment(body), WFDictionaryKey="single",
                       WFDictionaryValue=text(variable("已传媒体")))
        w.assign("已传媒体", first, append=True)
        multiple = w.add("setvalueforkey", WFDictionary=attachment(single), WFDictionaryKey="multiple",
                         WFDictionaryValue=text(variable("已传媒体")))
        w.add("gettext", WFTextActionText=text(multiple))
        workflow["WFWorkflowActions"] = w.actions
        workflow["WFWorkflowName"] = "直传离线验证2"
        workflow["WFWorkflowTypes"] = []
        return workflow
    secret = w.add("gettext", WFTextActionText="SHORTCUT_TOKEN_PLACEHOLDER")
    w.assign("上传口令", secret)
    auth = w.add("gettext", WFTextActionText=text("Bearer ", variable("上传口令")))
    w.assign("Authorization", auth)

    if smoke:
        body = w.add("gettext", WFTextActionText="Synthetic direct-upload verification")
        w.assign("正文", body)
        date = w.add("gettext", WFTextActionText="2026-10-12")
        w.assign("手帐日期", date)
        w.assign("上传文件", {"Type": "ExtensionInput"})
    else:
        for index, action in enumerate(original[:35]):
            if index in (15, 16):
                continue  # Ordinary videos stay original: no slow re-encoding.
            action = copy.deepcopy(action)
            if index == 17:
                action["WFWorkflowActionParameters"]["WFInput"] = attachment(variable("原媒体"))
            w.actions.append(action)
            if index == 4:
                w.assign("手帐日期", {
                    "Type": "ActionOutput",
                    "OutputUUID": action["WFWorkflowActionParameters"]["UUID"],
                    "OutputName": "格式化后的日期",
                })

    repeat = uid()
    w.add("repeat.each", GroupingIdentifier=repeat, WFControlFlowMode=0,
          WFInput=attachment(variable("上传文件")))
    w.assign("当前文件", variable("Repeat Item"))
    name = w.add("properties.files", WFContentItemPropertyName="Name",
                 WFInput=attachment(variable("当前文件")))
    w.assign("文件名", name)
    extension = w.add("properties.files", WFContentItemPropertyName="File Extension",
                      WFInput=attachment(variable("当前文件")))
    full_name = w.add("gettext", WFTextActionText=text(variable("文件名"), ".", extension))
    w.assign("完整文件名", full_name)
    match = w.add("text.match", text=text(extension), WFMatchTextPattern="(?i)^m4v$")
    mime = w.add("gettext", WFTextActionText="application/octet-stream")
    w.assign("准备类型", mime)
    group = w.condition(match)
    mime = w.add("gettext", WFTextActionText="video/mp4")
    w.assign("准备类型", mime)
    w.close(group)
    mov = w.add("text.match", text=text(extension), WFMatchTextPattern="(?i)^mov$")
    group = w.condition(mov)
    mime = w.add("gettext", WFTextActionText="video/quicktime")
    w.assign("准备类型", mime)
    w.close(group)
    mp4 = w.add("text.match", text=text(extension), WFMatchTextPattern="(?i)^(mp4|m4v)$")
    group = w.condition(mp4)
    mime = w.add("gettext", WFTextActionText="video/mp4")
    w.assign("准备类型", mime)
    w.close(group)

    prepared = w.post(base + "/api/quick/prepare", {
        "files": [{"name": variable("完整文件名"), "mime": variable("准备类型")}],
    })
    w.fail_if_error(prepared, "准备上传失败")
    files = w.value(prepared, "files")
    first = w.add("getitemfromlist", WFInput=attachment(files), WFItemSpecifier="First Item")
    key = w.value(first, "key")
    group = w.condition(key, condition=101)
    w.add("alert", WFAlertActionTitle="无法直传", WFAlertActionMessage="请使用照片/视频，压缩包仍用原指令。")
    w.add("exit")
    w.close(group)
    mime = w.value(first, "mime")
    w.assign("对象Key", key)
    w.assign("对象类型", mime)
    upload_url = w.value(first, "uploadUrl")
    w.assign("直传地址", upload_url)
    mode = w.value(prepared, "mode")

    # Signed OSS PUTs never receive the website's Bearer secret.
    is_oss = w.add("text.match", text=text(mode), WFMatchTextPattern="^oss$")
    group = w.condition(is_oss)
    w.add(
        "downloadurl", WFURL=text(upload_url), WFHTTPMethod="PUT", ShowHeaders=True,
        WFHTTPBodyType="File", WFRequestVariable=attachment(variable("当前文件")),
        WFHTTPHeaders=dictionary({"Content-Type": mime}),
    )
    w.close(group, otherwise=True)
    w.add(
        "downloadurl", WFURL=text(base, upload_url), WFHTTPMethod="PUT", ShowHeaders=True,
        WFHTTPBodyType="File", WFRequestVariable=attachment(variable("当前文件")),
        WFHTTPHeaders=dictionary({"Content-Type": mime, "Authorization": text_auth()}),
    )
    w.close(group)
    item = w.add("dictionary", WFItems=dictionary({
        "key": key, "name": variable("完整文件名"), "mime": mime,
    }))
    w.close(repeat, repeat=True)
    w.assign("已传媒体", variable("Repeat Results"))

    fields = {"type": "journal", "text": variable("正文"), "date": variable("手帐日期")}
    if smoke:
        fields["debugMediaCount"] = w.add("count", WFInput=attachment(variable("已传媒体")))
    body = w.add("dictionary", WFItems=dictionary(fields))
    w.assign("登记内容", body)
    count = w.add("count", WFInput=attachment(variable("已传媒体")))
    positive = w.add("text.match", text=text(count), WFMatchTextPattern="^[1-9][0-9]*$")
    has_media = w.condition(positive)
    single = w.add("text.match", text=text(count), WFMatchTextPattern="^1$")
    single_group = w.condition(single)
    body = w.add("dictionary", WFItems=dictionary({
        **fields,
        "media": [{"key": variable("对象Key"), "name": variable("完整文件名"), "mime": variable("对象类型")}],
    }))
    w.assign("登记内容", body)
    w.close(single_group, otherwise=True)
    body = w.add(
        "setvalueforkey", WFDictionary=attachment(variable("登记内容")),
        WFDictionaryKey="media", WFDictionaryValue=text(variable("已传媒体")),
    )
    w.assign("登记内容", body)
    w.close(single_group)
    w.close(has_media)
    # Native dictionary-to-text coercion produces JSON without hand-escaping diary text.
    json_text = w.add("gettext", WFTextActionText=text(variable("登记内容")))
    response = w.add(
        "downloadurl", WFURL=base + "/api/quick", WFHTTPMethod="POST", ShowHeaders=True,
        WFHTTPBodyType="File", WFRequestVariable=attachment(json_text),
        WFHTTPHeaders=dictionary({"Authorization": text_auth(), "Content-Type": "application/json"}),
    )
    w.fail_if_error(response, "登记失败，请先确认是否已保存再重试")
    count = w.value(response, "mediaCount")
    path = w.value(response, "path")
    w.add("notification", WFNotificationActionBody=text("手帐已保存，", count, " 项媒体\n", path))
    workflow["WFWorkflowActions"] = w.actions
    workflow["WFWorkflowName"] = "本机上传链路诊断" if smoke else "记手帐直传"
    workflow["WFWorkflowHasShortcutInputVariables"] = smoke
    workflow["WFWorkflowTypes"] = ["WFWorkflowTypeShowInSearch"]
    return workflow


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--base", required=True, help="站点根地址，如 https://example.com")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    source = plistlib.loads(args.template.read_bytes())
    result = build(source, args.base.rstrip("/"), args.smoke, args.offline)
    args.output.write_bytes(plistlib.dumps(result, fmt=plistlib.FMT_BINARY, sort_keys=False))
    print(f"{len(result['WFWorkflowActions'])} native actions -> {args.output}")
