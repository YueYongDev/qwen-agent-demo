"""Test script for WebSearchTool."""
import asyncio
import os
import sys
from typing import Dict, Any

# Add the backend path to the sys.path to import modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from app.tools.web_search import WebSearchTool


def test_web_search():
    """Test the WebSearchTool functionality."""
    print("Testing WebSearchTool...")
    
    # 创建工具实例
    tool = WebSearchTool()
    
    # 准备测试参数
    test_params = {
        "query": "Python programming language",
        "num_results": 3,
        "fetch_content": True,
        "gl": "us"
    }
    
    print(f"Calling WebSearchTool with params: {test_params}")
    
    # 调用工具
    result = tool.call(test_params)
    
    print(f"Result: {result}")
    
    # 检查结果是否包含错误
    if "error" in result:
        print(f"Error occurred: {result['error']}")
        return False
    elif "results" in result:
        print(f"Successfully received {len(result['results'])} results")
        for i, res in enumerate(result['results']):
            print(f"Result {i+1}:")
            print(f"  Title: {res.get('title', 'N/A')}")
            print(f"  URL: {res.get('url', 'N/A')}")
            print(f"  Snippet: {res.get('snippet', 'N/A')[:100]}...")
        return True
    else:
        print("Unexpected result format")
        return False


if __name__ == "__main__":
    success = test_web_search()
    if success:
        print("\nWebSearchTool test passed!")
    else:
        print("\nWebSearchTool test failed!")
        sys.exit(1)