# Pupurin° Loom 示例脚本 (DEMO)
# 用于验证 .rpy 解析与节点流图渲染

label start:
    "清晨，阳光透过窗帘洒进来。"
    e "新的一天开始了。"
    menu:
        "去花园看看":
            jump garden
        "继续睡觉":
            jump sleep
    return

label garden:
    scene bg garden
    "你来到了花园，花香扑鼻。"
    e "今天的花开得真美。"
    jump end

label sleep:
    "你翻了个身，继续沉睡。"
    "……"
    jump end

label end:
    "故事结束。"
    return
