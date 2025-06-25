export interface ChartData {
  spent: number;
  remaining: number;
  budget: number;
  percentage: number;
  type: 'daily' | 'weekly' | 'monthly';
  period: string;
}

export class ChartService {
  private readonly QUICKCHART_BASE_URL = 'https://quickchart.io/chart';

  /**
   * LINE公式のローディングアニメーション用プログレスデータを生成
   */
  generateProgressData(data: ChartData): { percentage: number; color: string; status: string } {
    const { percentage } = data;
    
    const getColorAndStatus = (percentage: number) => {
      if (percentage <= 50) return { color: '#06C755', status: 'Good' };
      if (percentage <= 80) return { color: '#FF9500', status: 'Warning' };
      return { color: '#FF334B', status: 'Over Budget' };
    };

    const { color, status } = getColorAndStatus(percentage);
    
    return {
      percentage: Math.min(percentage, 100),
      color,
      status
    };
  }

  /**
   * 円形進捗チャートのURLを生成（週間レポート用に残す）
   */
  generateProgressChart(data: ChartData): string {
    const { spent, remaining, budget, percentage, type, period } = data;
    
    // 色の設定（パーセンテージに基づく）
    const getColor = (percentage: number): string => {
      if (percentage <= 50) return '#4CAF50'; // 緑
      if (percentage <= 80) return '#FF9800'; // オレンジ
      return '#F44336'; // 赤
    };

    const primaryColor = getColor(percentage);
    const backgroundColor = '#E0E0E0';

    const chartConfig = {
      type: 'doughnut',
      data: {
        labels: ['使用済み', '残り'],
        datasets: [{
          data: [spent, remaining],
          backgroundColor: [primaryColor, backgroundColor],
          borderWidth: 0,
          cutout: '70%'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: false
          }
        },
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 1500,
          easing: 'easeInOutQuart'
        }
      }
    };

    // 中央にテキストを表示するプラグイン
    const centerTextPlugin = {
      id: 'centerText',
      beforeDraw: function(chart: any) {
        const ctx = chart.canvas.getContext('2d');
        const centerX = chart.width / 2;
        const centerY = chart.height / 2;
        
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = primaryColor;
        ctx.font = 'bold 24px Arial';
        ctx.fillText(`${percentage.toFixed(1)}%`, centerX, centerY - 10);
        
        ctx.fillStyle = '#666666';
        ctx.font = '12px Arial';
        ctx.fillText(`¥${spent.toLocaleString()}`, centerX, centerY + 15);
        ctx.restore();
      }
    };

    const params = new URLSearchParams({
      c: JSON.stringify(chartConfig),
      w: '300',
      h: '300',
      f: 'png',
      bkg: 'white'
    });

    return `${this.QUICKCHART_BASE_URL}?${params}`;
  }

  /**
   * 線形進捗バーチャートのURLを生成
   */
  generateLinearProgressChart(data: ChartData): string {
    const { spent, budget, percentage, type, period } = data;
    
    const getColor = (percentage: number): string => {
      if (percentage <= 50) return '#4CAF50';
      if (percentage <= 80) return '#FF9800';
      return '#F44336';
    };

    const primaryColor = getColor(percentage);

    const chartConfig = {
      type: 'bar',
      data: {
        labels: [period],
        datasets: [{
          label: '使用済み',
          data: [spent],
          backgroundColor: primaryColor,
          borderRadius: 8,
          barThickness: 40
        }, {
          label: '予算',
          data: [budget],
          backgroundColor: '#E0E0E0',
          borderRadius: 8,
          barThickness: 40
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: false
          }
        },
        scales: {
          x: {
            display: false,
            max: Math.max(budget, spent) * 1.1
          },
          y: {
            display: false
          }
        },
        animation: {
          duration: 2000,
          easing: 'easeInOutQuart'
        }
      }
    };

    const params = new URLSearchParams({
      c: JSON.stringify(chartConfig),
      w: '400',
      h: '100',
      f: 'png',
      bkg: 'white'
    });

    return `${this.QUICKCHART_BASE_URL}?${params}`;
  }

  /**
   * シンプルなプログレスインジケーターのURLを生成
   */
  generateCombinedChart(data: ChartData): string {
    const { spent, remaining, budget, percentage, type, period } = data;
    
    const getColor = (percentage: number): string => {
      if (percentage <= 50) return '#4CAF50';
      if (percentage <= 80) return '#FF9800';
      return '#F44336';
    };

    const primaryColor = getColor(percentage);
    const backgroundFillWidth = Math.min(percentage, 100);

    // シンプルなプログレスバーデザイン
    const chartConfig = {
      type: 'bar',
      data: {
        labels: [''],
        datasets: [
          {
            label: '',
            data: [backgroundFillWidth],
            backgroundColor: primaryColor,
            borderRadius: 25,
            barThickness: 20,
            maxBarThickness: 20
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            display: false,
            grid: {
              display: false
            }
          },
          y: {
            display: false,
            grid: {
              display: false
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: false
          }
        },
        animation: {
          duration: 1500,
          easing: 'easeOutQuart'
        },
        layout: {
          padding: {
            left: 10,
            right: 10,
            top: 15,
            bottom: 15
          }
        }
      }
    };

    const params = new URLSearchParams({
      c: JSON.stringify(chartConfig),
      w: '300',
      h: '50',
      f: 'png',
      bkg: 'transparent'
    });

    return `${this.QUICKCHART_BASE_URL}?${params}`;
  }

  /**
   * 色を明るくする関数
   */
  private lightenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
  }

  /**
   * 週間進捗の折れ線グラフを生成
   */
  generateWeeklyTrendChart(weeklyData: { day: string; spent: number }[]): string {
    const chartConfig = {
      type: 'line',
      data: {
        labels: weeklyData.map(d => d.day),
        datasets: [{
          label: '日別支出',
          data: weeklyData.map(d => d.spent),
          borderColor: '#2196F3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#2196F3',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: '#E0E0E0'
            }
          }
        },
        animation: {
          duration: 2500,
          easing: 'easeInOutQuart'
        }
      }
    };

    const params = new URLSearchParams({
      c: JSON.stringify(chartConfig),
      w: '400',
      h: '200',
      f: 'png',
      bkg: 'white'
    });

    return `${this.QUICKCHART_BASE_URL}?${params}`;
  }
}

export const chartService = new ChartService();