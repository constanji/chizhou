#!/bin/bash

# 朋友圈模板占位符处理脚本
# 版本：1.0.0
# 用途：批量处理模板文件中的占位符替换

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示帮助信息
show_help() {
    cat << EOF
朋友圈模板占位符处理脚本

用法：$0 [选项] <模板文件> <输出文件>

选项：
  -h, --help          显示此帮助信息
  -v, --verbose       显示详细输出
  -d, --dry-run       只显示替换计划，不实际执行
  -c, --config FILE   使用指定的配置文件
  -t, --template TYPE 指定模板类型（food/travel/event/achievement/daily）
  -o, --output DIR    指定输出目录

示例：
  $0 -t food template.md output.md
  $0 -c config.json template.md output.md
  $0 --dry-run -v template.md output.md

配置文件格式（JSON）：
{
  "variables": {
    "[日期]": "2025-12-05",
    "[时间]": "下午3:30",
    "[地点]": "北京故宫"
  },
  "format": {
    "add_hashtags": true,
    "add_emojis": true,
    "check_grammar": true
  }
}
EOF
}

# 解析命令行参数
parse_arguments() {
    TEMPLATE_FILE=""
    OUTPUT_FILE=""
    CONFIG_FILE=""
    TEMPLATE_TYPE=""
    OUTPUT_DIR="."
    VERBOSE=false
    DRY_RUN=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            -t|--template)
                TEMPLATE_TYPE="$2"
                shift 2
                ;;
            -o|--output)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            *)
                if [[ -z "$TEMPLATE_FILE" ]]; then
                    TEMPLATE_FILE="$1"
                elif [[ -z "$OUTPUT_FILE" ]]; then
                    OUTPUT_FILE="$1"
                else
                    log_error "未知参数: $1"
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # 检查必要参数
    if [[ -z "$TEMPLATE_FILE" ]]; then
        log_error "必须指定模板文件"
        show_help
        exit 1
    fi
    
    if [[ -z "$OUTPUT_FILE" ]]; then
        OUTPUT_FILE="${TEMPLATE_FILE%.*}_processed.md"
    fi
    
    # 确保输出目录存在
    mkdir -p "$OUTPUT_DIR"
    OUTPUT_FILE="$OUTPUT_DIR/$(basename "$OUTPUT_FILE")"
}

# 检查文件是否存在
check_file_exists() {
    if [[ ! -f "$1" ]]; then
        log_error "文件不存在: $1"
        exit 1
    fi
}

# 加载配置文件
load_config() {
    local config_file="$1"
    
    if [[ ! -f "$config_file" ]]; then
        log_warning "配置文件不存在: $config_file，使用默认配置"
        return 1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_warning "jq 命令未安装，无法解析 JSON 配置文件"
        return 1
    fi
    
    # 从配置文件加载变量
    if [[ -f "$config_file" ]]; then
        VARIABLES=$(jq -r '.variables | to_entries | map("\(.key)=\(.value|tostring)") | join("\n")' "$config_file" 2>/dev/null)
        if [[ $? -eq 0 ]]; then
            log_info "从配置文件加载变量"
        fi
    fi
}

# 获取动态变量值
get_dynamic_variable() {
    local var_name="$1"
    
    case "$var_name" in
        "[日期]")
            date "+%Y年%m月%d日"
            ;;
        "[时间]")
            date "+%H:%M"
            ;;
        "[星期]")
            date "+%A" | sed 's/Monday/星期一/;s/Tuesday/星期二/;s/Wednesday/星期三/;s/Thursday/星期四/;s/Friday/星期五/;s/Saturday/星期六/;s/Sunday/星期日/'
            ;;
        "[年份]")
            date "+%Y年"
            ;;
        "[月份]")
            date "+%m月"
            ;;
        "[季节]")
            local month=$(date "+%m")
            case $month in
                12|01|02) echo "冬季" ;;
                03|04|05) echo "春季" ;;
                06|07|08) echo "夏季" ;;
                09|10|11) echo "秋季" ;;
            esac
            ;;
        *)
            echo ""
            ;;
    esac
}

# 交互式获取变量值
get_variable_interactive() {
    local var_name="$1"
    local default_value="$2"
    local prompt="$3"
    
    if [[ -n "$default_value" ]]; then
        read -p "$prompt [$default_value]: " value
        value="${value:-$default_value}"
    else
        read -p "$prompt: " value
    fi
    
    echo "$value"
}

# 提取模板中的变量
extract_variables() {
    local template_file="$1"
    
    # 提取所有 [变量名] 格式的占位符
    grep -o '\[[^]]*\]' "$template_file" | sort | uniq
}

# 替换变量
replace_variables() {
    local input_file="$1"
    local output_file="$2"
    local variables_file="$3"
    
    # 创建临时文件
    local temp_file=$(mktemp)
    cp "$input_file" "$temp_file"
    
    # 从变量文件加载变量映射
    declare -A var_map
    if [[ -f "$variables_file" ]]; then
        while IFS='=' read -r key value; do
            [[ -n "$key" ]] && var_map["$key"]="$value"
        done < "$variables_file"
    fi
    
    # 提取并替换变量
    local variables=$(extract_variables "$temp_file")
    
    log_info "找到 ${#variables[@]} 个变量需要替换"
    
    for var in $variables; do
        # 检查是否已定义
        if [[ -n "${var_map[$var]}" ]]; then
            local value="${var_map[$var]}"
            log_info "替换 $var -> $value"
            
            # 执行替换（处理特殊字符）
            local escaped_var=$(echo "$var" | sed 's/\[/\\[/g; s/\]/\\]/g')
            local escaped_value=$(echo "$value" | sed 's/&/\\&/g; s#/#\\/#g')
            
            if [[ "$DRY_RUN" == "true" ]]; then
                log_info "[DRY RUN] 将替换: $var -> $value"
            else
                sed -i "s/$escaped_var/$escaped_value/g" "$temp_file"
            fi
        else
            log_warning "未定义变量: $var"
        fi
    done
    
    # 复制到输出文件
    if [[ "$DRY_RUN" != "true" ]]; then
        cp "$temp_file" "$output_file"
        log_success "文件已保存到: $output_file"
    fi
    
    # 清理临时文件
    rm -f "$temp_file"
}

# 检查格式规范
check_format() {
    local file="$1"
    local errors=0
    
    log_info "检查格式规范..."
    
    # 检查段落长度
    local long_paragraphs=$(awk 'BEGIN{para=0; len=0} /^$/{if(len>6){print para": "len"行"}; para++; len=0} !/^$/{len++} END{if(len>6){print para": "len"行"}}' "$file")
    if [[ -n "$long_paragraphs" ]]; then
        log_warning "发现过长段落:"
        echo "$long_paragraphs"
        ((errors++))
    fi
    
    # 检查标签格式
    local bad_hashtags=$(grep -n '#[^# ]*[ ].*#' "$file" || true)
    if [[ -n "$bad_hashtags" ]]; then
        log_warning "发现格式错误的话题标签:"
        echo "$bad_hashtags"
        ((errors++))
    fi
    
    # 检查表情符号使用
    local emoji_count=$(grep -o -e "😊\|😄\|🎉\|🌟\|👍\|🙏\|❤️\|💝\|🍔\|🍕\|🍣\|☕\|✈️\|🏖️\|🗺️\|📚\|🎓\|💡\|🧠\|🏃‍♂️\|⚽\|🏀\|🎨\|🎵\|🎮\|🎬" "$file" | wc -l)
    if [[ $emoji_count -gt 10 ]]; then
        log_warning "表情符号使用过多: $emoji_count 个"
        ((errors++))
    fi
    
    if [[ $errors -eq 0 ]]; then
        log_success "格式检查通过"
    else
        log_warning "发现 $errors 个格式问题"
    fi
}

# 生成变量映射文件
generate_variable_mapping() {
    local template_type="$1"
    local mapping_file="$2"
    
    cat > "$mapping_file" << EOF
# 朋友圈模板变量映射文件
# 模板类型: $template_type
# 生成时间: $(date)

# 动态变量（自动生成）
[日期]=$(get_dynamic_variable "[日期]")
[时间]=$(get_dynamic_variable "[时间]")
[星期]=$(get_dynamic_variable "[星期]")
[年份]=$(get_dynamic_variable "[年份]")
[月份]=$(get_dynamic_variable "[月份]")
[季节]=$(get_dynamic_variable "[季节]")

# 请填写以下变量值
[地点]=
[人物]=
[心情形容词]=
[活动描述]=
[美食名称]=
[餐厅名称]=
[旅行地点]=
[活动名称]=
[成就名称]=
[生活场景]=

# 格式变量（可选）
[表情符号]=
[话题标签]=
EOF
    
    log_info "变量映射文件已生成: $mapping_file"
    log_info "请编辑该文件填写变量值，然后重新运行脚本"
}

# 主函数
main() {
    log_info "朋友圈模板占位符处理脚本 v1.0.0"
    
    # 解析参数
    parse_arguments "$@"
    
    # 检查模板文件
    check_file_exists "$TEMPLATE_FILE"
    
    # 加载配置文件
    if [[ -n "$CONFIG_FILE" ]]; then
        load_config "$CONFIG_FILE"
    fi
    
    # 创建变量映射文件
    local mapping_file="${TEMPLATE_FILE%.*}_variables.txt"
    
    if [[ ! -f "$mapping_file" ]]; then
        log_info "未找到变量映射文件，正在生成..."
        generate_variable_mapping "$TEMPLATE_TYPE" "$mapping_file"
        exit 0
    fi
    
    # 执行变量替换
    replace_variables "$TEMPLATE_FILE" "$OUTPUT_FILE" "$mapping_file"
    
    # 检查格式规范
    if [[ "$DRY_RUN" != "true" ]]; then
        check_format "$OUTPUT_FILE"
    fi
    
    # 显示统计信息
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "处理完成统计:"
        log_info "  模板文件: $TEMPLATE_FILE"
        log_info "  输出文件: $OUTPUT_FILE"
        log_info "  变量文件: $mapping_file"
        log_info "  模板类型: $TEMPLATE_TYPE"
        
        if [[ -f "$OUTPUT_FILE" ]]; then
            local line_count=$(wc -l < "$OUTPUT_FILE")
            local word_count=$(wc -w < "$OUTPUT_FILE")
            local char_count=$(wc -m < "$OUTPUT_FILE")
            
            log_info "  行数: $line_count"
            log_info "  字数: $word_count"
            log_info "  字符数: $char_count"
        fi
    fi
    
    log_success "处理完成！"
}

# 执行主函数
main "$@"